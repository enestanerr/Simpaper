// Main-process entry: hands the layer factories to the composition root (src/main/app/bootstrap.ts).
// First import: sizes libuv's thread pool before anything queues work on it (see app/threadpool.ts).
import './app/threadpool';
import { isAllowedUnoCommand, isSubscribableUnoCommand } from '@shared/commands';
import { bootstrap } from './app/bootstrap';
import { createEngineManager } from './engine';
import { createPdfService } from './pdf';
import { createPlatform } from './platform';

bootstrap({ createEngineManager, createPlatform, createPdfService, isAllowedUnoCommand, isSubscribableUnoCommand });
