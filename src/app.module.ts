import { SecurityModule } from './security/security.module';
import { SimulationModule } from './simulation/simulation.module';
import { AstronautsModule } from './astronauts/astronauts.module';
import { MonitoringModule } from './monitoring/monitoring.module';
import { AlertsModule } from './alerts/alerts.module';
import { MedicalModule } from './medical/medical.module';
import { HistoryModule } from './history/history.module';
import { NasaModule } from './nasa/nasa.module';
import { SupabaseModule } from './supabase/supabase.module';
import { PlatformModule } from './platform/platform.module';
import { Module } from '@nestjs/common';
import { AiModule } from './ai/ai.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';

@Module({
  imports: [
    SecurityModule,
    AiModule,
    SimulationModule,
    AstronautsModule,
    MonitoringModule,
    AlertsModule,
    MedicalModule,
    HistoryModule,
    NasaModule,
    SupabaseModule,
    PlatformModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
