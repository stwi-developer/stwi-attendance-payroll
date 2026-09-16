import {
  IsDateString,
  IsEmail,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  MinLength,
} from 'class-validator';

export class CreateEmployeeDto {
  @IsString() @MinLength(1) employeeCode!: string;
  @IsString() @MinLength(1) name!: string;

  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsDateString() joiningDate?: string;
  @IsOptional() @IsString() departmentId?: string;
  @IsOptional() @IsString() designationId?: string;

  @IsNumber() @Min(0) grossSalary!: number;

  @IsOptional() @IsDateString() salaryEffectiveFrom?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  securityDepositAlreadyTaken?: number;
}