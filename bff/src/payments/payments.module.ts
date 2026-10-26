import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';

@Module({
    controllers: [PaymentsController],
    providers: [PaymentsService, PrismaService],
})
export class PaymentsModule implements NestModule {
    configure(consumer: MiddlewareConsumer) {
        // Middleware runs before guards/pipes so error responses are protected too.
        consumer.apply((_req: Request, res: Response, next: NextFunction) => {
            res.setHeader('Cache-Control', 'no-store');
            res.setHeader('Referrer-Policy', 'no-referrer');
            next();
        }).forRoutes(PaymentsController);
    }
}
