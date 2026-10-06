import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { AccountLinksService } from './account-links.service';
import { AuthService } from './auth.service';
import { TokenService } from './token.service';

@Module({
  imports: [JwtModule.register({})], // secrets passed per call from validated env
  controllers: [AuthController],
  providers: [AuthService, TokenService, AccountLinksService],
  exports: [AuthService, TokenService],
})
export class AuthModule {}
