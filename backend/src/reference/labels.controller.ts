import { BadRequestException, Body, Controller, Delete, Get, Param, Put, Req, UseGuards } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { AuthGuard, AuthenticatedRequest } from '../auth/auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';

// V1.9: popup texts and button labels. The frontend holds the default texts;
// only the texts changed by the CEO are stored here.
@UseGuards(AuthGuard, RolesGuard)
@Controller('labels')
export class LabelsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async all() {
    const rows = await this.prisma.appLabel.findMany();
    return Object.fromEntries(rows.map((r) => [r.key, r.value]));
  }

  @Put(':key')
  @Roles('CEO')
  async set(@Req() req: AuthenticatedRequest, @Param('key') key: string, @Body() body: { value?: string }) {
    const value = String(body?.value ?? '').trim();
    if (!/^[a-zA-Z0-9_.-]{1,120}$/.test(key)) throw new BadRequestException('Invalid label key.');
    if (!value) throw new BadRequestException('Label text cannot be empty. Use Reset to go back to the default text.');
    if (value.length > 2000) throw new BadRequestException('Label text is too long.');
    return this.prisma.appLabel.upsert({ where: { key }, update: { value, updatedById: req.user.id }, create: { key, value, updatedById: req.user.id } });
  }

  @Delete(':key')
  @Roles('CEO')
  async reset(@Param('key') key: string) {
    await this.prisma.appLabel.deleteMany({ where: { key } });
    return { reset: true, key };
  }
}
