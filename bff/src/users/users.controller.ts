// src/users/users.controller.ts
import { Controller, Get, Post, Body, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { UsersService } from './users.service';

@Controller('users')
export class UsersController {
    constructor(private readonly usersService: UsersService) {}

    // Intentionally not registered in UsersModule. Keep future reads account-scoped.
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth('jwt')
    @Get()
    findAll(@Req() req: { user: { sub: string } }) {
        return this.usersService.findAll(req.user.sub);
    }

    // POST /users → vytvoření nového uživatele
    @Post()
    create(
        @Body('email') email: string,
        @Body('password') password: string,
        @Body('name') name: string,
        @Body('country') country: string,
    ) {
        return this.usersService.createUser({ email, password, name, country });
    }

    // POST /users/login → ověření uživatele
    @Post('login')
    async login(
        @Body('email') email: string,
        @Body('password') password: string,
    ) {
        const user = await this.usersService.validateUser(email, password);
        if (!user) {
            return { success: false, message: 'Invalid email or password' };
        }
        return { success: true, user };
    }
}
