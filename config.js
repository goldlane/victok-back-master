import dotenv from 'dotenv';
import path from 'path';
const __dirname = path.resolve();

if (process.env.NODE_ENV === 'development') {
  dotenv.config({ path: path.join(__dirname, './.env.development') });
} else if (process.env.NODE_ENV === 'production') {
  dotenv.config({ path: path.join(__dirname, './.env.production') });
}
function required(key, defaultValue = undefined) {
  const value = process.env[key] || defaultValue;
  if (value == null) {
    throw new Error(`Key ${key} is undefined`);
  }
  return value;
}

export const config = {
  jwt: {
    secretKey: required('JWT_SECRET_KEY'),
    expiresInSec: parseInt(required('JWT_EXPIRES_SEC', 86400)),
  },
  bcrypt: {
    saltRounds: parseInt(required('BCRYPT_SALT_ROUNDS', 12)),
  },
  host: {
    port: parseInt(required('HOST_PORT', 4000)),
  },
  db: {
    host: required('DB_HOST'),
    user: required('DB_USER'),
    database: required('DB_DATABASE'),
    password: required('DB_PASSWORD'),
  },
  aligo: {
    key: required('ALIGO_KEY'),
    id: required('ALIGO_ID'),
    sender: required('ALIGO_SENDER'),
    senderkey: required('ALIGO_SENDER_KEY'),
  },
};

export const URI = required('URI');
