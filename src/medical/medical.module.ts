import {
  Body,
  Controller,
  Get,
  Headers,
  Module,
  NotFoundException,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { z } from 'zod';
import { SimulationModule } from '../simulation/simulation.module';
import { SimulationService } from '../simulation/simulation.service';
import { session } from '../simulation/simulation.controller';
import { crewId, id, mutationSchema, parse } from '../simulation/contracts';
import { answerLocal, episodeFingerprint } from '../simulation/domain/analysis';
import { DEMO_PROTOCOLS } from '../simulation/shared/protocols';
import { reduce } from '../simulation/domain/reduce';
@Controller('api/medical')
export class MedicalController {
  constructor(private readonly simulations: SimulationService) {}
  @Get('episodes') episodes(
    @Headers('x-simulation-id') sid: string,
    @Query() query: unknown,
  ) {
    const q = parse(z.object({ crewId: crewId.optional() }).strict(), query);
    return {
      simulated: true,
      episodes: this.simulations
        .get(session(sid))
        .state.episodes.filter((e) => !q.crewId || e.crewId === q.crewId),
    };
  }
  @Get('episodes/:id') episode(
    @Headers('x-simulation-id') sid: string,
    @Param('id') id: string,
  ) {
    const state = this.simulations.get(session(sid)).state;
    const episode = state.episodes.find((e) => e.id === id);
    if (!episode) throw new NotFoundException('Episodio desconocido');
    return {
      simulated: true,
      episode,
      symptoms: state.symptoms.filter((s) => s.episodeId === id),
      analyses: state.analyses.filter((a) => a.episodeId === id),
      summary: answerLocal(state, id, 'resumen'),
    };
  }
  @Post('symptoms') symptom(
    @Headers('x-simulation-id') sid: string,
    @Body() body: unknown,
  ) {
    const q = parse(
      mutationSchema
        .extend({
          crewId,
          symptoms: z.array(z.string().min(1).max(80)).max(12),
          note: z.string().max(2000),
        })
        .strict(),
      body,
    );
    return this.simulations.action(
      session(sid),
      q.requestId,
      q.expectedRevision,
      {
        type: 'addSymptom',
        crewId: q.crewId,
        symptoms: q.symptoms,
        note: q.note,
        idempotencyKey: q.requestId,
      },
    );
  }
  @Get('episodes/:id/analysis') analysis(
    @Headers('x-simulation-id') sid: string,
    @Param('id') id: string,
    @Query() query: unknown,
  ) {
    const q = parse(
      z.object({ question: z.string().max(1000).default('resumen') }).strict(),
      query,
    );
    const state = this.simulations.get(session(sid)).state;
    const result = answerLocal(state, id, q.question);
    if (!result) throw new NotFoundException('Episodio desconocido');
    return {
      source: 'local_engine',
      simulated: true,
      result,
      fingerprint: episodeFingerprint(state, id),
    };
  }
  @Post('episodes/:id/analysis') saveAnalysis(
    @Headers('x-simulation-id') sid: string,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const q = parse(
      mutationSchema
        .extend({ question: z.string().max(1000).default('resumen') })
        .strict(),
      body,
    );
    return this.simulations.mutate(
      session(sid),
      q.requestId,
      q.expectedRevision,
      { type: 'local-analysis', episodeId: id, question: q.question },
      (state) => {
        const episode = state.episodes.find((e) => e.id === id);
        const result = answerLocal(state, id, q.question);
        if (!episode || !result)
          throw new NotFoundException('Episodio desconocido');
        return reduce(state, {
          type: 'recordAnalysis',
          idempotencyKey: q.requestId,
          record: {
            id: `analysis-${q.requestId}`,
            episodeId: id,
            crewId: episode.crewId,
            source: 'local_engine',
            createdAt: state.clock.simulatedAt,
            model: null,
            fingerprint: episodeFingerprint(state, id),
            snapshot: {
              measurementIds: state.measurements
                .filter((m) => m.crewId === episode.crewId)
                .map((m) => m.id),
              symptomIds: state.symptoms
                .filter((s) => s.episodeId === id)
                .map((s) => s.id),
              alertIds: state.alerts
                .filter((a) => a.crewId === episode.crewId)
                .map((a) => a.id),
              resourceIds: state.resources.map((r) => r.id),
              protocolIds: DEMO_PROTOCOLS.map((p) => p.id),
            },
            result,
          },
        });
      },
    );
  }
  @Post('episodes/:id/review') review(
    @Headers('x-simulation-id') sid: string,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const q = parse(mutationSchema.strict(), body);
    const state = this.simulations.get(session(sid)).state;
    const episode = state.episodes.find((e) => e.id === id);
    const result = answerLocal(state, id, 'resumen');
    if (!episode || !result)
      throw new NotFoundException('Episodio desconocido');
    return this.simulations.action(
      session(sid),
      q.requestId,
      q.expectedRevision,
      {
        type: 'createCommunication',
        crewId: episode.crewId,
        episodeId: id,
        subject: 'Solicitud de revisión humana',
        body: result.summary,
        idempotencyKey: q.requestId,
      },
    );
  }
  @Get('communications') communications(
    @Headers('x-simulation-id') sid: string,
  ) {
    return {
      simulated: true,
      communications: this.simulations.get(session(sid)).state.communications,
    };
  }
  @Post('communications') draft(
    @Headers('x-simulation-id') sid: string,
    @Body() body: unknown,
  ) {
    const q = parse(
      mutationSchema
        .extend({
          crewId,
          episodeId: id.nullable(),
          subject: z.string().min(3).max(180),
          body: z.string().min(3).max(4000),
        })
        .strict(),
      body,
    );
    return this.simulations.action(
      session(sid),
      q.requestId,
      q.expectedRevision,
      {
        type: 'createCommunication',
        crewId: q.crewId,
        episodeId: q.episodeId,
        subject: q.subject,
        body: q.body,
        idempotencyKey: q.requestId,
      },
    );
  }
  @Post('communications/:id/status') transition(
    @Headers('x-simulation-id') sid: string,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const q = parse(
      mutationSchema
        .extend({ status: z.enum(['queued', 'sent', 'received']) })
        .strict(),
      body,
    );
    return this.simulations.action(
      session(sid),
      q.requestId,
      q.expectedRevision,
      { type: 'transitionCommunication', id, status: q.status },
    );
  }
}
@Module({ imports: [SimulationModule], controllers: [MedicalController] })
export class MedicalModule {}
