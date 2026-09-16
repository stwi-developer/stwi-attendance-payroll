import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, Res, UploadedFiles, UseGuards, UseInterceptors } from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import JSZip from 'jszip';
import { AuthGuard, AuthenticatedRequest } from '../auth/auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { RunsService } from './runs.service';

@UseGuards(AuthGuard, RolesGuard)
@Controller('runs')
export class RunsController {
  constructor(private readonly service: RunsService) {}

  @Get() list(@Query() query: any) { return this.service.list(query); }
  @Post() @Roles('CEO','HR') create(@Req() req: AuthenticatedRequest, @Body() body: { year: number; month: number }) { return this.service.create(req.user.id, Number(body.year), Number(body.month)); }
  @Get(':id') get(@Param('id') id: string) { return this.service.get(id); }
  @Delete(':id') @Roles('CEO','HR') removeRun(@Req() req: AuthenticatedRequest, @Param('id') id: string) { return this.service.removeRun(req.user.id, id); }
  @Delete(':id/files/:fileId') @Roles('CEO','HR','JUNIOR_HR') deleteFile(@Req() req: AuthenticatedRequest, @Param('id') id: string, @Param('fileId') fileId: string) { return this.service.deleteFile(req.user.id, id, fileId); }
  @Post(':id/upload')
  @Roles('CEO','HR','JUNIOR_HR')
  @UseInterceptors(FilesInterceptor('files', 50))
  async upload(@Req() req: AuthenticatedRequest, @Param('id') id: string, @UploadedFiles() files: Express.Multer.File[]) {
    const expanded: Express.Multer.File[] = [];
    for (const file of files ?? []) {
      if (!/\.zip$/i.test(file.originalname)) {
        expanded.push(file);
        continue;
      }
      const zip = await JSZip.loadAsync(file.buffer);
      for (const [entryName, entry] of Object.entries(zip.files)) {
        if (entry.dir || !/\.(xlsx|xls|csv)$/i.test(entryName)) continue;
        const buffer = await entry.async('nodebuffer');
        expanded.push({
          ...file,
          originalname: entryName.split('/').pop() || entryName,
          buffer,
          size: buffer.length,
          mimetype: /\.csv$/i.test(entryName) ? 'text/csv' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        });
      }
    }
    if (!expanded.length) throw new Error('ZIP contains no .xlsx, .xls or .csv attendance files.');
    return this.service.uploadFiles(req.user.id, id, expanded);
  }
  @Post(':id/process') @Roles('CEO','HR','JUNIOR_HR') process(@Req() req: AuthenticatedRequest, @Param('id') id: string) { return this.service.processRun(req.user.id, id); }
  @Post(':id/calculate') @Roles('CEO','HR','JUNIOR_HR') calculate(@Req() req: AuthenticatedRequest, @Param('id') id: string) { return this.service.calculatePayroll(id, req.user.id); }
  @Get(':id/attendance-summary') attendanceSummary(@Param('id') id: string) { return this.service.attendanceSummary(id); }
  @Get(':id/attendance') attendance(@Param('id') id: string, @Query() query: any) { return this.service.attendance(id, query); }
  @Post(':id/attendance/manual') @Roles('CEO','HR','JUNIOR_HR') addManualAttendance(@Req() req: AuthenticatedRequest, @Param('id') id: string, @Body() body: any) { return this.service.addManualAttendance(req.user.id, id, body); }
  @Patch(':id/attendance/:attendanceId') @Roles('CEO','HR','JUNIOR_HR') updateAttendance(@Req() req: AuthenticatedRequest, @Param('id') id: string, @Param('attendanceId') attendanceId: string, @Body() body: any) { return this.service.updateAttendance(req.user.id, id, attendanceId, body); }
  @Delete(':id/attendance/:attendanceId') @Roles('CEO','HR','JUNIOR_HR') deleteAttendance(@Req() req: AuthenticatedRequest, @Param('id') id: string, @Param('attendanceId') attendanceId: string) { return this.service.deleteAttendance(req.user.id, id, attendanceId); }
  @Get(':id/reviews') reviews(@Param('id') id: string, @Query() query: any) { return this.service.reviews(id, query); }
  @Delete('/reviews/:reviewId') @Roles('CEO','HR') deleteReview(@Req() req: AuthenticatedRequest, @Param('reviewId') reviewId: string) { return this.service.deleteReview(req.user.id, reviewId); }
  @Patch('/reviews/:reviewId') @Roles('CEO','HR','JUNIOR_HR') resolveReview(@Req() req: AuthenticatedRequest, @Param('reviewId') reviewId: string, @Body() body: any) { return this.service.resolveReview(req.user.id, reviewId, body); }
  @Get(':id/payroll') payroll(@Param('id') id: string, @Query() query: any) { return this.service.payroll(id, query); }
  @Patch(':id/payroll/:employeeId') @Roles('CEO','HR') updatePayrollResult(@Req() req: AuthenticatedRequest, @Param('id') id: string, @Param('employeeId') employeeId: string, @Body() body: any) { return this.service.updatePayrollResult(req.user.id, id, employeeId, body); }
  @Patch(':id/payroll/:employeeId/other-deduction') @Roles('CEO','HR') setOtherDeduction(@Req() req: AuthenticatedRequest, @Param('id') id: string, @Param('employeeId') employeeId: string, @Body() body: { amount: number }) { return this.service.setOtherDeduction(req.user.id, id, employeeId, Number(body.amount)); }
  @Patch(':id/payroll/:employeeId/security-deposit') @Roles('CEO','HR') setDepositMethod(@Req() req: AuthenticatedRequest, @Param('id') id: string, @Param('employeeId') employeeId: string, @Body() body: { method: 'FULL'|'EMI_3_MONTHS' }) { return this.service.setDepositMethod(req.user.id, id, employeeId, body.method); }
  @Post(':id/finalize') @Roles('CEO','HR') finalize(@Req() req: AuthenticatedRequest, @Param('id') id: string) { return this.service.finalize(req.user.id, id); }
  @Post(':id/reopen') @Roles('CEO','HR') reopen(@Req() req: AuthenticatedRequest, @Param('id') id: string) { return this.service.reopen(req.user.id, id); }
  @Get(':id/export') async export(@Param('id') id: string, @Res() res: Response) { const buffer = await this.service.exportWorkbook(id); res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'); res.setHeader('Content-Disposition', `attachment; filename=STWI_Attendance_Payroll_${id}.xlsx`); res.send(buffer); }
  @Patch(':runId/payroll/:employeeId/security-deposit/reset')
@Roles('CEO', 'HR')
async resetDepositMethod(
  @Req() req: AuthenticatedRequest,
  @Param('runId') runId: string,
  @Param('employeeId') employeeId: string,
) {
  return this.service.resetDepositMethod(
    req.user.id,
    runId,
    employeeId,
  );
}
}
