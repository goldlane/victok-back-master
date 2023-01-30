import dayjs from 'dayjs';
import express from 'express';
import { body, query } from 'express-validator';
import { db } from '../db/database.js';
import { checkUserGrade } from '../middleware/cron.js';
import { isAuth, validate } from '../middleware/functions.js';

const router = express.Router();

// 결제 시 유저(가맹점) 정보 받기
router.get('/store', isAuth, async (req, res) => {
  const userInfo = await db
    .execute(
      `SELECT user.name AS user_name, user.phone, user.email, store.address1, store.zip_code FROM store JOIN user ON store.user_idx=user.idx WHERE store.user_idx=${req.authorizedUser}`
    )
    .then((result) => result[0][0]);
  res.status(200).json(userInfo);
});

// 결제 정보 저장 & 유료 회원으로 전환
router.post('/payment', isAuth, async (req, res) => {
  const { imp_uid, merchant_uid, payment_name, amount, card_name, card_number, receipt_url, isExtension } = req.body;
  const prevEndDate = !isExtension
    ? null
    : await db
        .execute(`SELECT end_date FROM payment_history WHERE user_idx=${req.authorizedUser} ORDER BY end_date DESC LIMIT 1`)
        .then((result) => result[0][0].end_date);
  await db.execute(
    'INSERT INTO payment_history (user_idx, imp_uid, merchant_uid, payment_name, amount, card_name, card_number, paid_time, start_date, end_date, receipt_url) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
    [
      req.authorizedUser,
      imp_uid,
      merchant_uid,
      payment_name,
      amount,
      card_name,
      card_number,
      new Date(),
      !isExtension ? dayjs().add(1, 'day').format('YYYY-MM-DD') : dayjs(prevEndDate).add(1, 'day').format('YYYY-MM-DD'),
      !isExtension ? dayjs().add(1, 'year').format('YYYY-MM-DD') : dayjs(prevEndDate).add(1, 'year').format('YYYY-MM-DD'),
      receipt_url,
    ]
  );
  await db.execute(`UPDATE user SET grade=1 WHERE idx=${req.authorizedUser}`);
  await db.execute(`UPDATE talk_dday SET deleted_time=NULL WHERE user_idx=${req.authorizedUser}&&dday!=3`);
  res.status(201).json({ message: '유료 회원으로 변경, 알림톡 디데이 설정 복구됨.' });
});

// 결제 내역(기간 검색)
router.get('/payment', isAuth, async (req, res) => {
  const { start_date, end_date } = req.query;
  console.log(req.query);
  if (!(start_date && end_date)) {
    const paymentHistory = await db
      .execute(
        `SELECT payment_name, paid_time,start_date,end_date, amount, receipt_url, refund_idx FROM payment_history WHERE user_idx=${req.authorizedUser} ORDER BY payment_history.idx DESC`
      )
      .then((result) => result[0]);
    res.status(200).json(paymentHistory);
  } else {
    const paymentHistory = await db
      .execute(
        `SELECT payment_name, paid_time,start_date,end_date,  amount, receipt_url, refund_idx FROM payment_history WHERE user_idx=${
          req.authorizedUser
        }&&payment_history.paid_time BETWEEN '${dayjs(`${start_date}-01-01`).format('YYYY-MM-DD')}' AND '${dayjs(`${end_date}-12-31`).format(
          'YYYY-MM-DD'
        )}' ORDER BY payment_history.idx DESC`
      )
      .then((result) => result[0]);
    res.status(200).json(paymentHistory);
  }
});

router.get('/test', isAuth, async (req, res) => {
  const result = await checkUserGrade();
  res.status(200).json(result);
});

export default router;
