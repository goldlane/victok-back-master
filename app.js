import express from 'express';
import morgan from 'morgan';
import cors from 'cors';
import helmet from 'helmet';
import { config } from './config.js';
import userRouter from './src/router/user.js';
import lockerRouter from './src/router/locker.js';
import adminRouter from './src/router/admin.js';
import customerRouter from './src/router/customer.js';
import paymentRouter from './src/router/payment.js';
import nodeCron from 'node-cron';
import { calculateDate, remain3Days } from './src/middleware/cron.js';
import fs from 'fs';

try {
  fs.readdirSync('uploads');
} catch (error) {
  console.error('make uploads folder');
  fs.mkdirSync('uploads');
}
// 다음날이 되면 라커 사용일, 잔여일 재설정
// second minute hour day-of-month month day-of-week
nodeCron.schedule('10 0 0 * * *', () => {
  console.log('날짜 계산');
  calculateDate();
});

// 오전 10시마다 체크 - 카카오 알림톡 발송
nodeCron.schedule('0 10 * * *', () => {
  remain3Days();
});

const app = express();

app.use(express.json());
app.use(morgan('dev'));
app.use(cors());
app.use(helmet());

app.use('/api/user', userRouter);
app.use('/api/locker', lockerRouter);
app.use('/api/admin', adminRouter);
app.use('/api/customer', customerRouter);
app.use('/api/payment', paymentRouter);
app.use('/uploads/', express.static('uploads'));

app.use((req, res, next) => {
  res.sendStatus(404);
});

app.use((error, req, res, next) => {
  console.error(error);
  res.sendStatus(500);
});

app.listen(config.host.port, () => {
  console.log('Connected 4000 port.');
});
app.get('/',(req,res)=>{
  res.send('Hello World!')
})