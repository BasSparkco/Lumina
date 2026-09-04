import { Injectable } from '@nestjs/common';

// Injectable indirection over `new Date()` so entitlement expiry/trial checks can be tested
// deterministically (freeze "now" to a fixed instant via a mock) instead of monkey-patching the
// Date global or racing real wall-clock time in assertions.
@Injectable()
export class Clock {
  now(): Date {
    return new Date();
  }
}
