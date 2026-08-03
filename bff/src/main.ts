import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { SwaggerModule, DocumentBuilder } from "@nestjs/swagger";
import "dotenv/config";

import { NestExpressApplication } from "@nestjs/platform-express";
import { join } from "path";
import { HttpLoggingInterceptor } from "./common/interceptors/http-logging.interceptor";

async function bootstrap() {
    const app = await NestFactory.create<NestExpressApplication>(AppModule);

    app.useGlobalPipes(
        new ValidationPipe({
            whitelist: true,
            transform: true,
        }),
    );
    app.useGlobalInterceptors(new HttpLoggingInterceptor());

    const config = new DocumentBuilder()
        .setTitle("Memotrip API")
        .setDescription("API dokumentace pro Memotrip aplikaci")
        .setVersion("1.0")
        .addBearerAuth(
            { type: "http", scheme: "bearer", bearerFormat: "JWT", in: "header" },
            "jwt",
        )
        .build();

    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup("swagger", app, document);

    // servíruj /uploads/*
    app.useStaticAssets(join(process.cwd(), "uploads"), { prefix: "/uploads" });

    await app.listen(3000, "0.0.0.0");
}

bootstrap();
