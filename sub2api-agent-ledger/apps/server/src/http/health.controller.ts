import { Controller, Get } from '@nestjs/common';

@Controller('api')
export class HealthController {
  @Get('health')
  health() {
    return {
      code: 'OK',
      message: 'ok',
      data: { service: 'sub2api-agent-ledger', status: 'ready' },
      requestId: `req_health`,
    };
  }
}
