import { Body, Controller, Get, Headers, Param, Post, Query } from '@nestjs/common'
import { PlatformService } from './platform.service'
import { careApprovalSchema, careStartSchema } from '../ai/care.contract'
import { BadRequestException } from '@nestjs/common'
import type { DemoRole, MissionStage } from './types'

@Controller('api/platform')
export class PlatformController {
  constructor(private readonly platform: PlatformService) {}

  private profile(@Headers('x-helios-session') token?: string) {
    return this.platform.requireSession(token)
  }

  @Get('profiles')
  profiles() {
    return { profiles: this.platform.listProfiles() }
  }

  @Post('auth/select')
  select(@Body() body: { profileId?: string }) {
    return this.platform.selectProfile(body.profileId || '')
  }

  @Get('me')
  me(@Headers('x-helios-session') token?: string) {
    return { profile: this.profile(token) }
  }

  @Get('missions')
  missions(@Headers('x-helios-session') token?: string) {
    return { items: this.platform.listMissionsFor(this.profile(token)) }
  }

  @Get('missions/:id')
  mission(@Headers('x-helios-session') token?: string, @Param('id') id?: string) {
    return this.platform.getMission(this.profile(token), id || '')
  }

  @Post('missions')
  create(@Headers('x-helios-session') token?: string, @Body() body?: Record<string, unknown>) {
    return this.platform.createMission(this.profile(token), {
      name: String(body?.name || 'Nueva misión'),
      destination: body?.destination ? String(body.destination) : '',
      plannedStart: body?.plannedStart ? String(body.plannedStart) : null,
      durationDays: Number(body?.durationDays || 30),
      plannedCrewCount: Number(body?.plannedCrewCount || 4),
      timezone: body?.timezone ? String(body.timezone) : 'UTC',
      activities: Array.isArray(body?.activities) ? body.activities.map(String) : [],
      commsNotes: body?.commsNotes ? String(body.commsNotes) : '',
      storageNotes: body?.storageNotes ? String(body.storageNotes) : '',
    })
  }

  @Post('missions/join')
  join(@Headers('x-helios-session') token?: string, @Body() body?: { code?: string; role?: DemoRole }) {
    const raw = body?.role || 'crew'
    const role: Exclude<DemoRole, 'chief'> = raw === 'medic' || raw === 'psychologist' || raw === 'ops' ? raw : 'crew'
    return this.platform.requestJoin(this.profile(token), body?.code || '', role)
  }

  @Post('missions/:id/join-decide')
  decide(
    @Headers('x-helios-session') token?: string,
    @Param('id') id?: string,
    @Body() body?: { membershipId?: string; accept?: boolean },
  ) {
    return this.platform.decideJoin(this.profile(token), id || '', body?.membershipId || '', Boolean(body?.accept))
  }

  @Post('missions/:id/draft')
  draft(@Headers('x-helios-session') token?: string, @Param('id') id?: string, @Body() body?: Record<string, unknown>) {
    return this.platform.updateMissionDraft(this.profile(token), id || '', body as never)
  }

  @Get('missions/:id/prep')
  prep(@Headers('x-helios-session') token?: string, @Param('id') id?: string) {
    return this.platform.listPrep(this.profile(token), id || '')
  }

  @Post('missions/:id/prep')
  upsertPrep(@Headers('x-helios-session') token?: string, @Param('id') id?: string, @Body() body?: Record<string, unknown>) {
    return this.platform.upsertPrep(this.profile(token), id || '', {
      id: body?.id ? String(body.id) : undefined,
      title: String(body?.title || ''),
      category: String(body?.category || 'general'),
      description: body?.description ? String(body.description) : '',
      source: body?.source ? String(body.source) : undefined,
      status: body?.status as never,
      critical: Boolean(body?.critical),
      applies: body?.applies === undefined ? true : Boolean(body.applies),
      evidence: body?.evidence ? String(body.evidence) : undefined,
      qtyRequired: body?.qtyRequired == null ? null : Number(body.qtyRequired),
      qtyAvailable: body?.qtyAvailable == null ? null : Number(body.qtyAvailable),
    })
  }

  @Post('missions/:id/prep/suggest')
  suggest(@Headers('x-helios-session') token?: string, @Param('id') id?: string) {
    return this.platform.suggestPrep(this.profile(token), id || '')
  }

  @Post('missions/:id/prep/commit-ai')
  commitAi(
    @Headers('x-helios-session') token?: string,
    @Param('id') id?: string,
    @Body() body?: { titles?: string[] },
  ) {
    return this.platform.commitAiPrep(this.profile(token), id || '', body?.titles)
  }

  @Get('missions/:id/start-check')
  startCheck(@Headers('x-helios-session') token?: string, @Param('id') id?: string) {
    this.platform.assertMissionAccess(this.profile(token), id || '')
    return this.platform.evaluateStart(id || '')
  }

  @Post('missions/:id/start')
  start(@Headers('x-helios-session') token?: string, @Param('id') id?: string, @Body() body?: { confirm?: boolean }) {
    return this.platform.startSimulatedMission(this.profile(token), id || '', Boolean(body?.confirm))
  }

  @Post('missions/:id/stage')
  stage(@Headers('x-helios-session') token?: string, @Param('id') id?: string, @Body() body?: { stage?: MissionStage }) {
    return this.platform.setStage(this.profile(token), id || '', body?.stage || 'preflight')
  }

  @Get('missions/:id/wake')
  wake(@Headers('x-helios-session') token?: string, @Param('id') id?: string, @Query('justWoke') justWoke?: string) {
    return this.platform.getOrCreateWakeCheck(this.profile(token), id || '', justWoke === '1')
  }

  @Post('missions/:id/wake')
  wakeComplete(@Headers('x-helios-session') token?: string, @Param('id') id?: string, @Body() body?: Record<string, unknown>) {
    return this.platform.completeWakeCheck(this.profile(token), id || '', body || {})
  }

  @Get('missions/:id/sleep')
  sleepList(@Headers('x-helios-session') token?: string, @Param('id') id?: string, @Query('subjectId') subjectId?: string) {
    return { items: this.platform.listSleep(this.profile(token), id || '', subjectId) }
  }

  @Post('missions/:id/sleep')
  sleepAdd(@Headers('x-helios-session') token?: string, @Param('id') id?: string, @Body() body?: { startAt?: number; endAt?: number; quality?: number; kind?: string }) {
    return this.platform.addSleep(this.profile(token), id || '', Number(body?.startAt), Number(body?.endAt), body?.quality ?? null, body?.kind || 'nap')
  }

  @Get('missions/:id/symptoms')
  symptoms(@Headers('x-helios-session') token?: string, @Param('id') id?: string, @Query('subjectId') subjectId?: string) {
    return { items: this.platform.listSymptoms(this.profile(token), id || '', subjectId) }
  }

  @Post('missions/:id/symptoms')
  symptomAdd(@Headers('x-helios-session') token?: string, @Param('id') id?: string, @Body() body?: Record<string, unknown>) {
    return this.platform.addSymptom(this.profile(token), id || '', {
      description: String(body?.description || ''),
      startedAt: body?.startedAt == null ? null : Number(body.startedAt),
      intensity: body?.intensity == null ? null : Number(body.intensity),
      context: String(body?.context || ''),
      source: String(body?.source || 'self_report'),
    })
  }

  @Get('missions/:id/grants')
  grants(@Headers('x-helios-session') token?: string, @Param('id') id?: string) {
    return { items: this.platform.listGrants(this.profile(token), id || ''), chief: this.platform.chiefShareSummary(this.profile(token), id || '') }
  }

  @Post('missions/:id/grants')
  grant(@Headers('x-helios-session') token?: string, @Param('id') id?: string, @Body() body?: { granteeProfileId?: string; categories?: string[]; expiresAt?: number | null; scopeNote?: string }) {
    return this.platform.grantHealth(
      this.profile(token),
      id || '',
      body?.granteeProfileId || '',
      body?.categories || [],
      body?.expiresAt ?? null,
      body?.scopeNote || '',
    )
  }

  @Post('grants/:grantId/revoke')
  revoke(@Headers('x-helios-session') token?: string, @Param('grantId') grantId?: string) {
    return this.platform.revokeGrant(this.profile(token), grantId || '')
  }

  @Post('missions/:id/quiron')
  quironStart(@Headers('x-helios-session') token?: string, @Param('id') id?: string, @Body() body?: unknown) {
    const parsed = careStartSchema.safeParse(body ?? {})
    if (!parsed.success) throw new BadRequestException('Invalid conversation mode')
    return this.platform.startConversation(this.profile(token), id || '', parsed.data.mode, parsed.data.locale)
  }

  @Post('quiron/:conversationId/summary')
  quironSummary(
    @Headers('x-helios-session') token?: string,
    @Param('conversationId') conversationId?: string,
    @Body() body?: { body?: string; shareWith?: string | null; expectedMessages?: number },
  ) {
    const parsed = careApprovalSchema.safeParse(body)
    if (!parsed.success) throw new BadRequestException('Invalid summary approval')
    return this.platform.approveSummary(this.profile(token), conversationId || '', parsed.data.body, parsed.data.shareWith, parsed.data.expectedMessages)
  }

  @Get('missions/:id/quiron-summaries')
  summaries(@Headers('x-helios-session') token: string, @Param('id') id: string) {
    return { items: this.platform.listConversationSummaries(this.profile(token), id) }
  }

  @Post('missions/:id/urgent')
  urgent(@Headers('x-helios-session') token?: string, @Param('id') id?: string) {
    return this.platform.urgentHelp(this.profile(token), id || '')
  }

  @Get('missions/:id/appointments')
  appointments(@Headers('x-helios-session') token?: string, @Param('id') id?: string) {
    return { items: this.platform.listAppointments(this.profile(token), id || '') }
  }

  @Post('missions/:id/appointments')
  appointmentRequest(@Headers('x-helios-session') token?: string, @Param('id') id?: string, @Body() body?: Record<string, unknown>) {
    return this.platform.requestAppointment(this.profile(token), id || '', {
      specialty: String(body?.specialty || 'general'),
      professionalId: body?.professionalId ? String(body.professionalId) : null,
      modality: body?.modality ? String(body.modality) : 'aboard',
      reason: body?.reason ? String(body.reason) : '',
      summary: body?.summary ? String(body.summary) : '',
      scheduledAt: body?.scheduledAt == null ? null : Number(body.scheduledAt),
    })
  }

  @Post('appointments/:appointmentId/confirm')
  appointmentConfirm(
    @Headers('x-helios-session') token?: string,
    @Param('appointmentId') appointmentId?: string,
    @Body() body?: { accept?: boolean },
  ) {
    return this.platform.confirmAppointment(this.profile(token), appointmentId || '', Boolean(body?.accept))
  }

  @Get('evidence')
  evidence() {
    return { items: this.platform.listEvidence() }
  }
}