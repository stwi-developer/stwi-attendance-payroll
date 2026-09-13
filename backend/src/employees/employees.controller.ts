import { Body, Controller, Delete, Get, Param, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { EmployeesService } from './employees.service';
import { CreateEmployeeDto } from './dto/create-employee.dto';
import { UpdateEmployeeDto } from './dto/update-employee.dto';
import { AuthenticatedRequest } from '../auth/auth.guard';

@UseGuards(AuthGuard, RolesGuard)
@Controller('employees')
export class EmployeesController {
  constructor(private readonly service: EmployeesService) {}

  @Get()
  findAll(@Query() query: any) { return this.service.list(query); }

  @Get(':id')
  findOne(@Param('id') id: string) { return this.service.get(id); }

  @Post()
  @Roles('CEO', 'HR')
  create(@Body() dto: CreateEmployeeDto) { return this.service.create(dto); }

  @Put(':id')
  @Roles('CEO', 'HR')
  update(@Param('id') id: string, @Body() dto: UpdateEmployeeDto) { return this.service.update(id, dto); }

  @Delete(':id')
  @Roles('CEO', 'HR')
  remove(@Req() req: AuthenticatedRequest, @Param('id') id: string) { return this.service.remove(req.user.id, id); }
}
