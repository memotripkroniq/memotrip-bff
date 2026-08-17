import { Body, Controller, Get, Header, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import {
    ApiBearerAuth,
    ApiCreatedResponse,
    ApiExcludeEndpoint,
    ApiNotFoundResponse,
    ApiOperation,
    ApiTags,
    ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CreateDummyPaymentDto } from './dto/create-dummy-payment.dto';
import { CreateDummyPaymentResponseDto } from './dto/create-dummy-payment-response.dto';
import { ResolveDummyPaymentDto } from './dto/resolve-dummy-payment.dto';
import { PaymentsService } from './payments.service';

@ApiTags('Payments')
@Controller('payments')
export class PaymentsController {
    constructor(private readonly paymentsService: PaymentsService) {}

    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth('jwt')
    @Post('dummy')
    @ApiOperation({ summary: 'Create a pending DummyPay purchase for the current user' })
    @ApiCreatedResponse({ type: CreateDummyPaymentResponseDto })
    @ApiUnauthorizedResponse({ description: 'JWT auth required' })
    @ApiNotFoundResponse({ description: 'DummyPay is disabled in production' })
    async createDummyPayment(@Req() req: any, @Body() body: CreateDummyPaymentDto) {
        return this.paymentsService.createDummyPayment(req.user.sub, body.plan);
    }

    @Get('dummy/:purchaseId')
    @Header('Content-Type', 'text/html; charset=utf-8')
    @ApiExcludeEndpoint()
    async getDummyPaymentPage(
        @Param('purchaseId') purchaseId: string,
        @Query('token') token?: string,
    ) {
        return this.paymentsService.renderDummyPaymentPage(purchaseId, token);
    }

    @Post('dummy/:purchaseId/resolve')
    @Header('Content-Type', 'text/html; charset=utf-8')
    @ApiExcludeEndpoint()
    async resolveDummyPayment(
        @Param('purchaseId') purchaseId: string,
        @Query('token') token: string | undefined,
        @Body() body: ResolveDummyPaymentDto,
    ) {
        return this.paymentsService.resolveDummyPayment(purchaseId, token, body.result);
    }
}
