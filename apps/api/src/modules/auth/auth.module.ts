import { OAuthController } from './oauth.controller';
import { PhoneController } from './phone.controller';
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { AuthGuard, StaffMfaGuard } from './auth.guard';
import { AuthService } from './auth.service';
import { PasskeyController } from './passkey.controller';

@Module({
  imports: [
    JwtModule.registerAsync({
      useFactory: () => {
        const secret = process.env.JWT_ACCESS_SECRET;
        if (
          process.env.NODE_ENV === 'production' &&
          (!secret || secret.length < 32 || /change-me|dev-only|test-system/.test(secret))
        )
          throw new Error('Set a strong production JWT_ACCESS_SECRET');
        return {
          secret: process.env.JWT_ACCESS_SECRET ?? 'dev-only-access-secret-change-me',
          signOptions: {
            expiresIn: (process.env.JWT_ACCESS_TTL ?? '15m') as `${number}${'s' | 'm' | 'h' | 'd'}`,
          },
        };
      },
    }),
  ],
  controllers: [AuthController, OAuthController, PhoneController, PasskeyController],
  providers: [AuthService, AuthGuard, StaffMfaGuard],
  exports: [AuthService, AuthGuard, StaffMfaGuard, JwtModule],
})
export class AuthModule {}
