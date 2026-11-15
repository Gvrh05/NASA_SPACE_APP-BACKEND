import { Module } from '@nestjs/common';
import { PlatformModule } from '../platform/platform.module';
import { SimulationService } from './simulation.service';
import { SimulationController } from './simulation.controller';
@Module({
  imports: [PlatformModule],
  controllers: [SimulationController],
  providers: [SimulationService],
  exports: [SimulationService],
})
export class SimulationModule {}
