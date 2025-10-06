// src/users/users.controller.ts
import { Controller, Get, Post, Body } from '@nestjs/common';
import { UsersService } from './users.service';

@Controller('users')
export class UsersController {
    constructor(private readonly usersService: UsersService) {}

    // GET /users → vrátí všechny uživatele
    @Get()
    findAll() {
        return this.usersService.findAll();
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
