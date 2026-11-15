import { SimulationModule } from '../simulation/simulation.module';
import { SpaceAccessController } from './space-access.controller';
import { SpaceToolsService } from './space-tools.service';
import { SpaceConversationService } from './space-conversation.service';
import { Module } from '@nestjs/common';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';

@Module({
  imports: [SimulationModule],
  controllers: [AiController, SpaceAccessController],
  providers: [AiService, SpaceToolsService, SpaceConversationService],
})
export class AiModule {}
