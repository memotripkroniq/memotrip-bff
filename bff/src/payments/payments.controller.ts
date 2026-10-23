import { Body, Controller, Get, Header, Param, ParseUUIDPipe, Post, Query, Req, UseGuards } from '@nestjs/common';
import {
    ApiBearerAuth,
    ApiBadRequestResponse,
    ApiCreatedResponse,
    ApiExcludeEndpoint,
    ApiNotFoundResponse,
    ApiOperation,
    ApiOkResponse,
    ApiParam,
    ApiTags,
    ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CreateDummyPaymentDto } from './dto/create-dummy-payment.dto';
import { CreateDummyPaymentResponseDto } from './dto/create-dummy-payment-response.dto';
import { ResolveDummyPaymentDto } from './dto/resolve-dummy-payment.dto';
import { PaymentsService } from './payments.service';
import { DummyPaymentStatusResponseDto } from './dto/dummy-payment-status-response.dto';

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

    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth('jwt')
    @Get('dummy/:purchaseId/status')
    @Header('Cache-Control', 'no-store')
    @ApiOperation({ summary: 'Read the current user’s DummyPay purchase status', description: 'Read-only. Available in development and staging. No payment URL token is required.' })
    @ApiParam({ name: 'purchaseId', type: String, format: 'uuid' })
    @ApiOkResponse({ type: DummyPaymentStatusResponseDto })
    @ApiBadRequestResponse({ description: 'Invalid purchaseId UUID' })
    @ApiUnauthorizedResponse({ description: 'JWT auth required' })
    @ApiNotFoundResponse({ description: 'Purchase not found for this user, or DummyPay is disabled' })
    async getDummyPaymentStatus(
        @Req() req: any,
        @Param('purchaseId', new ParseUUIDPipe()) purchaseId: string,
    ): Promise<DummyPaymentStatusResponseDto> {
        return this.paymentsService.getDummyPaymentStatus(req.user.sub, purchaseId);
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
