import { Body, Controller, Post } from '@nestjs/common';
import { type SignUploadInput, signUploadSchema } from '@markethub/shared';
import { CurrentUser, type RequestUser } from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { UploadsService } from './uploads.service';

@Controller('images')
export class UploadsController {
  constructor(private readonly uploads: UploadsService) {}

  @Post('sign')
  sign(
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(signUploadSchema)) body: SignUploadInput,
  ) {
    return this.uploads.sign(user.id, body);
  }
}
