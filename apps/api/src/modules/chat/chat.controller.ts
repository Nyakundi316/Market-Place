import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import {
  type ConversationQuery,
  conversationQuerySchema,
  type CursorQuery,
  cursorQuerySchema,
  type ReadConversationInput,
  readConversationSchema,
  type SendMessageInput,
  sendMessageSchema,
  type StartConversationInput,
  startConversationSchema,
} from '@markethub/shared';
import type { Response } from 'express';
import { CurrentUser, type RequestUser } from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { ChatService } from './chat.service';

const id = new ParseUUIDPipe();

/** §4 REST fallback; the gateway is the primary path. Both go through ChatService. */
@Controller()
export class ChatController {
  constructor(private readonly chat: ChatService) {}

  @Get('conversations')
  list(
    @CurrentUser() user: RequestUser,
    @Query(new ZodValidationPipe(conversationQuerySchema)) q: ConversationQuery,
  ) {
    return this.chat.list(user.id, q);
  }

  @Get('conversations/:id')
  get(@CurrentUser() user: RequestUser, @Param('id', id) conversationId: string) {
    return this.chat.get(user.id, conversationId);
  }

  @Get('conversations/:id/messages')
  messages(
    @CurrentUser() user: RequestUser,
    @Param('id', id) conversationId: string,
    @Query(new ZodValidationPipe(cursorQuerySchema)) q: CursorQuery,
  ) {
    return this.chat.messages(user.id, conversationId, q);
  }

  /** 201 when a conversation was opened, 200 when it already existed. */
  @Post('conversations')
  async start(
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(startConversationSchema)) body: StartConversationInput,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { conversation, created } = await this.chat.start(user, body);
    res.status(created ? 201 : 200);
    return conversation;
  }

  // Throttled inside ChatService (shared with the socket), not by @RateLimit.
  @Post('messages')
  send(
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(sendMessageSchema)) body: SendMessageInput,
  ) {
    return this.chat.send(user, body);
  }

  @Post('conversations/:id/read')
  @HttpCode(200)
  async read(
    @CurrentUser() user: RequestUser,
    @Param('id', id) conversationId: string,
    @Body(new ZodValidationPipe(readConversationSchema)) body: ReadConversationInput,
  ) {
    return { receipt: await this.chat.read(user.id, conversationId, body.upTo) };
  }
}
