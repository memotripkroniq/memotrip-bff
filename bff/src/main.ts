import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import 'dotenv/config';


async function bootstrap() {
    const app = await NestFactory.create(AppModule);

    const config = new DocumentBuilder()
        .setTitle('Memotrip API')
        .setDescription('API dokumentace pro Memotrip aplikaci')
        .setVersion('1.0')
        .addBearerAuth()
        .build();

    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('swagger', app, document);

    // 🔥 DŮLEŽITÉ — dovolí real phone přístup přes LAN
    await app.listen(3000, '0.0.0.0');
}

bootstrap();