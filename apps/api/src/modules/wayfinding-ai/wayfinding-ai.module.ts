import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { WsModule } from '../ws/ws.module';
import { AuditModule } from '../audit/audit.module';
import { EntitlementsModule } from '../entitlements/entitlements.module';
import { WayfindingAiController } from './wayfinding-ai.controller';
import { WayfindingAiPlayerController } from './wayfinding-ai-player.controller';
import { WayfindingAiService } from './wayfinding-ai.service';
import { DestinationResolverService } from './destination-resolver.service';
import { WayfindingAiUsageService } from './wayfinding-ai-usage.service';
import { WAYFINDING_AI_PROVIDER, NullWayfindingAiProvider } from './providers/wayfinding-ai-provider';
import { OpenAiWayfindingAiProvider } from './providers/openai-wayfinding-ai.provider';

@Module({
  imports: [AuthModule, WsModule, AuditModule, EntitlementsModule],
  controllers: [WayfindingAiController, WayfindingAiPlayerController],
  providers: [
    WayfindingAiService,
    DestinationResolverService,
    WayfindingAiUsageService,
    {
      provide: WAYFINDING_AI_PROVIDER,
      // §3.6 — environment-selected, never hard-coded: a deployment with no AI_WAYFINDING_API_KEY
      // set (fresh install, local dev, an AI-less environment) still boots cleanly and falls back
      // to UNAVAILABLE only when a request genuinely needs the provider (no exact deterministic
      // match) rather than failing at startup.
      useFactory: () => {
        const apiKey = process.env.AI_WAYFINDING_API_KEY;
        if (!apiKey) return new NullWayfindingAiProvider();
        const model = process.env.AI_WAYFINDING_MODEL ?? 'gpt-4.1-mini';
        const timeoutMs = Number(process.env.AI_WAYFINDING_TIMEOUT_MS) || 8000;
        return new OpenAiWayfindingAiProvider(apiKey, model, timeoutMs);
      },
    },
  ],
  exports: [WayfindingAiService],
})
export class WayfindingAiModule {}
