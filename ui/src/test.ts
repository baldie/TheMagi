// This file is required by karma.conf.js and loads all the .test files

import 'zone.js/testing';
import { getTestBed } from '@angular/core/testing';
import {
  BrowserTestingModule,
  platformBrowserTesting
} from '@angular/platform-browser/testing';

// First, initialize the Angular testing environment.
getTestBed().initTestEnvironment(
  BrowserTestingModule,
  platformBrowserTesting(),
);

// Import all test files
import './app/app.test';