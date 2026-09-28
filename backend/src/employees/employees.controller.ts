import { Body, Controller, Delete, Get, Param, Post, Put, Query, Req, Res, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import { AuthGuard, AuthenticatedRequest } from '../auth/auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { EmployeesService } from './employees.service';
import { EmployeeImportService } from './employee-import.service';

// Bodies are plain objects: they are checked field by field in
// employee-fields.ts / EmployeesService.validate (V1.9).
type Payload = Record<string, any>;

@UseGuards(AuthGuard, RolesGuard)
@Controller('employees')
export class EmployeesController {
  constructor(private readonly service: EmployeesService) {}

  @Get()
  findAll(@Query() query: any) { return this.service.list(query); }

  @Get('fields')
  fields() { return this.service.fields(); }

  @Get(':id')
  findOne(@Req() req: AuthenticatedRequest, @Param('id') id: string) { return this.service.get(id, req.user.role); }

  @Post()
  @Roles('CEO', 'HR')
  create(@Req() req: AuthenticatedRequest, @Body() body: Payload) { return this.service.create(body ?? {}, req.user.id); }

  @Put(':id')
  @Roles('CEO', 'HR')
  update(@Req() req: AuthenticatedRequest, @Param('id') id: string, @Body() body: Payload) { return this.service.update(id, body ?? {}, req.user.id); }

  @Post(':id/salaries')
  @Roles('CEO', 'HR')
  addSalary(@Req() req: AuthenticatedRequest, @Param('id') id: string, @Body() body: Payload) { return this.service.addSalary(id, body ?? {}, req.user.id); }

  @Put(':id/salaries/:salaryId')
  @Roles('CEO', 'HR')
  updateSalary(@Req() req: AuthenticatedRequest, @Param('id') id: string, @Param('salaryId') salaryId: string, @Body() body: Payload) { return this.service.updateSalary(id, salaryId, body ?? {}, req.user.id); }

  @Delete(':id/salaries/:salaryId')
  @Roles('CEO', 'HR')
  deleteSalary(@Req() req: AuthenticatedRequest, @Param('id') id: string, @Param('salaryId') salaryId: string) { return this.service.deleteSalary(id, salaryId, req.user.id); }

  @Post(':id/deactivate')
  @Roles('CEO', 'HR')
  deactivate(@Req() req: AuthenticatedRequest, @Param('id') id: string, @Body() body: Payload) { return this.service.deactivate(id, body ?? {}, req.user.id); }

  @Post(':id/reactivate')
  @Roles('CEO', 'HR')
  reactivate(@Req() req: AuthenticatedRequest, @Param('id') id: string) { return this.service.reactivate(id, req.user.id); }

  @Get(':id/export')
  @Roles('CEO', 'HR')
  async export(@Req() req: AuthenticatedRequest, @Param('id') id: string, @Res() res: Response) {
    const { buffer, fileName } = await this.service.exportWorkbook(id, req.user.id);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
    res.send(buffer);
  }

  // Danger zone: CEO only
  @Delete(':id')
  @Roles('CEO')
  remove(@Req() req: AuthenticatedRequest, @Param('id') id: string, @Body() body: Payload) { return this.service.remove(req.user.id, id, body ?? {}); }
}

@UseGuards(AuthGuard, RolesGuard)
@Controller('employee-imports')
export class EmployeeImportController {
  constructor(private readonly service: EmployeeImportService) {}

  // imports hold Aadhaar / PAN / bank details: CEO and HR only
  @Get('current')
  @Roles('CEO', 'HR')
  current() { return this.service.current(); }

  @Get(':id')
  @Roles('CEO', 'HR')
  get(@Param('id') id: string) { return this.service.get(id); }

  @Post()
  @Roles('CEO', 'HR')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }))
  upload(@Req() req: AuthenticatedRequest, @UploadedFile() file: Express.Multer.File) { return this.service.upload(req.user.id, file); }

  @Put(':id/rows/:rowId')
  @Roles('CEO', 'HR')
  save(@Req() req: AuthenticatedRequest, @Param('id') id: string, @Param('rowId') rowId: string, @Body() body: Payload) { return this.service.saveDetails(req.user.id, id, rowId, body ?? {}); }

  @Post(':id/create')
  @Roles('CEO', 'HR')
  create(@Req() req: AuthenticatedRequest, @Param('id') id: string, @Body() body: Payload) { return this.service.create(req.user.id, id, body ?? {}); }

  @Post(':id/rows/:rowId/apply')
  @Roles('CEO', 'HR')
  apply(@Req() req: AuthenticatedRequest, @Param('id') id: string, @Param('rowId') rowId: string) { return this.service.apply(req.user.id, id, rowId); }

  @Post(':id/rows/:rowId/skip')
  @Roles('CEO', 'HR')
  skip(@Param('id') id: string, @Param('rowId') rowId: string) { return this.service.skip(id, rowId); }

  @Delete(':id')
  @Roles('CEO', 'HR')
  cancel(@Req() req: AuthenticatedRequest, @Param('id') id: string) { return this.service.cancel(req.user.id, id); }
}
