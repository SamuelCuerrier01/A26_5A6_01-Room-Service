import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export const LIMITE_MEMBRES_DEFAUT = 50;
export const LIMITE_MEMBRES_MAX = 100;
export const LIMITE_DECOUVERTE_DEFAUT = 10;

export class InviteMemberDto {
  @ApiProperty({ example: 'user-2' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  utilisateurId!: string;
}

export class KickMemberQueryDto {
  @ApiPropertyOptional({ example: 'user-2' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  nouveauProprietaire?: string;
}

export class UpdateMemberRoleDto {
  @ApiProperty({ enum: ['membre', 'moderateur'] })
  @IsIn(['membre', 'moderateur'])
  role!: 'membre' | 'moderateur';
}

export class DiscoverServersQueryDto {
  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => Number(value))
  @IsInt()
  @Min(0)
  decalage?: number;

  @ApiPropertyOptional({
    default: LIMITE_DECOUVERTE_DEFAUT,
    maximum: LIMITE_MEMBRES_MAX,
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => Number(value))
  @IsInt()
  @Min(1)
  @Max(LIMITE_MEMBRES_MAX)
  limite?: number;

  @ApiPropertyOptional({
    example: 'projet',
    description: 'Filtre sur le nom (contient, insensible à la casse).',
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MaxLength(80)
  q?: string;
}

export class PageQueryDto {
  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => Number(value))
  @IsInt()
  @Min(0)
  decalage?: number;

  @ApiPropertyOptional({
    default: LIMITE_MEMBRES_DEFAUT,
    maximum: LIMITE_MEMBRES_MAX,
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => Number(value))
  @IsInt()
  @Min(1)
  @Max(LIMITE_MEMBRES_MAX)
  limite?: number;
}

export class ListMembersQueryDto {
  @ApiPropertyOptional({
    default: 0,
    description: 'Nombre de membres à sauter (pagination).',
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => Number(value))
  @IsInt()
  @Min(0)
  decalage?: number;

  @ApiPropertyOptional({
    default: LIMITE_MEMBRES_DEFAUT,
    maximum: LIMITE_MEMBRES_MAX,
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => Number(value))
  @IsInt()
  @Min(1)
  @Max(LIMITE_MEMBRES_MAX)
  limite?: number;

  @ApiPropertyOptional({
    example: 'user-1,user-2',
    description:
      'Seulement ces utilisateurs (séparés par des virgules, 100 au plus) : ' +
      'sert à savoir lesquels sont déjà membres. Ignore la pagination.',
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string'
      ? [
          ...new Set(
            value
              .split(',')
              .map((id) => id.trim())
              .filter(Boolean),
          ),
        ]
      : value,
  )
  @IsArray()
  @ArrayMaxSize(LIMITE_MEMBRES_MAX)
  @IsString({ each: true })
  @MaxLength(255, { each: true })
  ids?: string[];
}
