// src/prisma/prisma.service.ts
import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
// importujeme klienta z vygenerované složky
import { PrismaClient } from '../../prisma/generated/prisma';


@Injectable()
export class PrismaService
    extends PrismaClient
    implements OnModuleInit, OnModuleDestroy
{
    async onModuleInit() {
        console.log('Connecting to the database...');
        await this.$connect();
        console.log('Database connected!');
    }

    async onModuleDestroy() {
        console.log('Disconnecting from the database...');
        await this.$disconnect();
        console.log('Database disconnected!');
    }
}
