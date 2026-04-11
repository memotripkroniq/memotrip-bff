import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { UsersModule } from './users/users.module';
import { AuthModule } from './auth/auth.module';
import { TripsModule } from './trips/trips.module'; // ⬅️ PŘIDAT
import { KroniqModule } from './kroniq/kroniq.module';

@Module({
  imports: [
    UsersModule,
    AuthModule,
    TripsModule, // ⬅️ KLÍČOVÝ ŘÁDEK
    KroniqModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
