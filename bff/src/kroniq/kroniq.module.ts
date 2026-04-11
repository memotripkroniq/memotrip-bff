import { Module } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { KroniqController } from './kroniq.controller';
import { KroniqService } from './kroniq.service';

@Module({
    controllers: [KroniqController],
    providers: [KroniqService, PrismaService],
})
export class KroniqModule {}
