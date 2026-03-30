require('dotenv').config();

const express = require('express');
const helmet = require('helmet');
const morgan = require('morgan');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;

const authRoutes = require('./routes/auth');
const usersRoutes = require('./routes/users');

const app = express();

// Security & parsing middleware
app.use(helmet());
app.use(morgan('combined'));
// CORS on auth service only needed for the OAuth redirect flow cookie.
// Specific origin required — never wildcard — because frontend sends credentials.
app.use(cors({ origin: process.env.CORS_ORIGIN, credentials: true }));
app.use(express.json());
app.use(cookieParser());

// Passport — stateless (no session).
// The strategy only extracts the Google profile; all DB gating happens in the
// route handler so the callback can issue the appropriate redirect.
passport.use(
  new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: process.env.GOOGLE_CALLBACK_URL,
    },
    (_accessToken, _refreshToken, profile, done) => {
      return done(null, {
        email: profile.emails[0].value,
        display_name: profile.displayName,
      });
    }
  )
);

app.use(passport.initialize());

// Routes
app.use('/auth', authRoutes);
app.use('/admin/users', usersRoutes);

// Health check — pings DB to keep Supabase free tier from pausing.
// UptimeRobot hits this every 10 min, replacing the need for cron-job.org.
app.get('/health', async (_req, res) => {
  try {
    const pool = require('./db');
    await pool.query('SELECT 1');
    res.status(200).json({ status: 'ok', service: 'auth', timestamp: new Date().toISOString() });
  } catch (err) {
    res.status(503).json({ status: 'error', service: 'auth', error: 'DB unreachable' });
  }
});

// 404 handler
app.use((_req, res) => res.status(404).json({ error: 'Not found' }));

// Global error handler
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

module.exports = app;
