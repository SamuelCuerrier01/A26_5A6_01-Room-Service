import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class CreateServerDto {
  @ApiProperty({ example: 'Projet final' })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  nom!: string;

  @ApiPropertyOptional({
    default: false,
    description:
      'Public : rejoignable sans invitation et trouvable par recherche.',
  })
  @IsOptional()
  @IsBoolean()
  public?: boolean;
}

const FORMAT_ICONE =
  /^(data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2})?$/;
const LONGUEUR_MAX_ICONE = 90_000;

export class UpdateServerDto {
  @ApiPropertyOptional({ example: 'Projet final' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  nom?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  public?: boolean;

  @ApiPropertyOptional({
    description:
      'Icône en data URL base64 (PNG, JPEG ou WebP) ; chaîne vide pour la retirer.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(LONGUEUR_MAX_ICONE)
  @Matches(FORMAT_ICONE, {
    message: 'icone must be a PNG, JPEG or WebP base64 data URL',
  })
  icone?: string;
}
