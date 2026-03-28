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
app.use(cors({ origin: process.env.CORS_ORIGIN || '*', credentials: true }));
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

// Health check — no auth required, used by UptimeRobot keep-alive pings
app.get('/health', (_req, res) =>
  res.status(200).json({ status: 'ok', service: 'auth', timestamp: new Date().toISOString() })
);

// 404 handler
app.use((_req, res) => res.status(404).json({ error: 'Not found' }));

// Global error handler
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

module.exports = app;
