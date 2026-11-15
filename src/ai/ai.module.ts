import { PlatformModule } from '../platform/platform.module';
import { PlatformConversationController } from './platform-conversation.controller';
import { PlatformConversationService } from './platform-conversation.service';
import { DialogueService } from './dialogue.service';
import { SimulationModule } from '../simulation/simulation.module';
import { SpaceAccessController } from './space-access.controller';
import { SpaceToolsService } from './space-tools.service';
import { SpaceConversationService } from './space-conversation.service';
import { Module } from '@nestjs/common';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';

@Module({
  imports: [SimulationModule, PlatformModule],
  controllers: [AiController, SpaceAccessController, PlatformConversationController],
  providers: [
    PlatformConversationService,
    DialogueService,
    AiService,
    SpaceToolsService,
    SpaceConversationService,
  ],
})
export class AiModule {}
