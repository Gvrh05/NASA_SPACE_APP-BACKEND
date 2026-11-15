import { Controller, Get, Headers, Module, Param } from '@nestjs/common';
import { SimulationModule } from '../simulation/simulation.module';
import { SimulationService } from '../simulation/simulation.service';
import { session } from '../simulation/session';
import { crewId, parse } from '../simulation/contracts';
import { CREW, crewById } from '../simulation/domain/crew';
import { crewPosture } from '../simulation/domain/selectors';
@Controller('api/astronauts')
export class AstronautsController {
  constructor(private readonly simulations: SimulationService) {}
  @Get() list() {
    return { simulated: true, astronauts: CREW };
  }
  @Get(':id') profile(
    @Param('id') id: string,
    @Headers('x-simulation-id') sid: string,
  ) {
    const target = parse(crewId, id);
    return {
      simulated: true,
      ...crewById(target),
      observed: crewPosture(this.simulations.get(session(sid)).state, target),
    };
  }
}
@Module({ imports: [SimulationModule], controllers: [AstronautsController] })
export class AstronautsModule {}
