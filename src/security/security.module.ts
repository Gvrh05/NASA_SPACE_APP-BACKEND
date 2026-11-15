import {
  MiddlewareConsumer,
  Module,
  NestModule,
  RequestMethod,
} from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { requestContext, SafeExceptionFilter } from './http-security';
import { RequestRateGuard } from './request-rate.guard';
@Module({
  providers: [
    { provide: APP_FILTER, useClass: SafeExceptionFilter },
    { provide: APP_GUARD, useClass: RequestRateGuard },
  ],
})
export class SecurityModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(requestContext)
      .forRoutes({ path: '{*path}', method: RequestMethod.ALL });
  }
}
