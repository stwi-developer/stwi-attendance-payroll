import { IsDateString, IsEmail, IsNumber, IsOptional, IsString, Min, MinLength } from 'class-validator';

export class UpdateEmployeeDto {
  @IsOptional() @IsString() @MinLength(1) name?: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsDateString() joiningDate?: string;
  @IsOptional() @IsString() departmentId?: string;
  @IsOptional() @IsString() designationId?: string;
  @IsOptional() @IsString() status?: 'ACTIVE' | 'INACTIVE';
  @IsOptional() @IsNumber() @Min(0) grossSalary?: number;
  @IsOptional() @IsDateString() salaryEffectiveFrom?: string;
}
