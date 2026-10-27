/* Aggregates all view partials into a single viewMethods object. */
import { landingViews } from './landing.js';
import { shellViews } from './shell.js';
import { cardViews } from './cards.js';
import { dashboardViews } from './dashboard.js';
import { auditViews } from './audit.js';
import { historyViews } from './history.js';
import { analyticsViews } from './analytics.js';
import { practiceViews } from './practice.js';
import { profileViews } from './profile.js';
import { passportViews } from './passport.js';
import { aboutViews } from './about.js';
import { settingsViews } from './settings.js';
import { sitemapViews } from './sitemap.js';
import { adminViews } from './admin.js';

export const viewMethods = {
  ...landingViews,
  ...shellViews,
  ...cardViews,
  ...dashboardViews,
  ...auditViews,
  ...historyViews,
  ...analyticsViews,
  ...practiceViews,
  ...profileViews,
  ...passportViews,
  ...aboutViews,
  ...settingsViews,
  ...sitemapViews,
  ...adminViews,
};
