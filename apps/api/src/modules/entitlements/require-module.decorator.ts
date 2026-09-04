import { SetMetadata } from '@nestjs/common';
import type { ModuleKey } from '@lumina/types';

export const REQUIRED_MODULE_KEY = 'requiredModule';
export const RequireModule = (moduleKey: ModuleKey) => SetMetadata(REQUIRED_MODULE_KEY, moduleKey);
