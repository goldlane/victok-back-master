import dayjs from 'dayjs';
import express from 'express';
import { body, query } from 'express-validator';
import { db } from '../db/database.js';
import { isAuth, validate } from '../middleware/functions.js';

const router = express.Router();

// 회원(customer) 등록
router.post(
  '/customer',
  isAuth,
  [
    body('customer_name').trim().notEmpty().withMessage('사용자 이름을 입력해 주세요.'),
    body('customer_phone').trim().notEmpty().withMessage('사용자 휴대폰 번호를 입력해 주세요.'),
    validate,
  ],
  async (req, res) => {
    const { customer_name, customer_phone, memo, user_idx } = req.body;
    const foundCustomer = await db
      .execute(
        `SELECT idx FROM customer WHERE user_idx=${
          user_idx ? user_idx : req.authorizedUser
        }&&name='${customer_name}'&&phone='${customer_phone}'&&deleted_time IS NULL`
      )
      .then((result) => result[0][0]);
    if (foundCustomer) {
      res.status(409).json({ message: `${customer_name} & ${customer_phone} 정보를 가진 이용자가 존재합니다.` });
    } else {
      await db.execute('INSERT INTO customer ( user_idx, name, phone, memo, created_time ) VALUES (?,?,?,?,?)', [
        user_idx ? user_idx : req.authorizedUser,
        customer_name,
        customer_phone,
        memo,
        new Date(),
      ]);
      res.sendStatus(201);
    }
  }
);

// 회원 정보
router.get(
  '/customer-info',
  isAuth,
  [query('customer_idx').trim().notEmpty().withMessage('customer_idx를 입력해 주세요.'), validate],
  async (req, res) => {
    const { customer_idx } = req.query;
    const customerInfo = await db
      .execute(`SELECT idx, name, phone, memo, user_idx FROM customer WHERE idx=${customer_idx}`)
      .then((result) => result[0][0]);
    console.log('회원정보', customerInfo);
    res.status(200).json(customerInfo);
  }
);

// 회원 정보 수정
router.put(
  '/customer-info',
  isAuth,
  [
    body('customer_idx').notEmpty().withMessage('customer_idx 입력해 주세요.'),
    body('name').notEmpty().withMessage('이름을 입력해 주세요.'),
    body('phone').notEmpty().withMessage('휴대폰 번호를 입력해 주세요.'),
    validate,
  ],
  async (req, res) => {
    const { customer_idx, name, phone, memo, user_idx } = req.body;
    const original = await db
      .execute(`SELECT idx FROM customer WHERE idx=${customer_idx}&&name='${name}'&&phone='${phone}'`)
      .then((result) => result[0][0]);
    if (original) {
      console.log('original', original);
      await db.execute('UPDATE customer SET name=?, phone=?, memo=? WHERE idx=?&&deleted_time IS NULL', [name, phone, memo, customer_idx]);
      res.sendStatus(204);
    } else {
      const foundCustomer = await db
        .execute(
          `SELECT idx FROM customer WHERE user_idx=${
            user_idx ? user_idx : req.authorizedUser
          }&&name='${name}'&&phone='${phone}'&&deleted_time IS NULL`
        )
        .then((result) => result[0][0]);
      if (foundCustomer) {
        console.log('foundCustomer', foundCustomer);
        res.status(409).json({ message: `해당 가맹점에 ${name} & ${phone} 정보를 가진 이용자가 존재합니다.` });
      } else {
        await db.execute('UPDATE customer SET name=?, phone=?, memo=? WHERE idx=?', [name, phone, memo, customer_idx]);
        res.sendStatus(204);
      }
    }
  }
);

// 회원 선택 삭제
router.post(
  '/customer-delete',
  isAuth,
  [body('idx').isLength({ min: 1 }).withMessage('customer_idx를 입력해 주세요.'), validate],
  async (req, res) => {
    const idxs = req.body.idx.split(',');
    console.log(idxs);
    for (const idx of idxs) {
      console.log('현', idx);
      const foundLocker = await db
        .execute(
          `SELECT * FROM (SELECT Max(locker.idx) as idx FROM locker WHERE locker_type IN (SELECT locker_type FROM locker WHERE customer_idx=${idx}&&deleted_time IS NULL GROUP BY locker_type, locker_number) && locker_number IN (SELECT locker_number FROM locker WHERE customer_idx =${idx}&&deleted_time IS NULL GROUP BY locker_type, locker_number) group by locker_type,locker_number) idx JOIN locker on idx.idx = locker.idx WHERE locker.customer_idx=${idx}`
        )
        .then((result) => result[0]);

      if (foundLocker.length > 0) {
        return res.status(409).json({ message: '라커를 이용하고 있는 회원은 삭제할 수 없습니다.' });
      }
    }
    await db.execute(`UPDATE customer SET deleted_time=? WHERE idx IN(${idxs})`, [new Date()]);
    res.sendStatus(204);
  }
);

// 지공차트 등록
router.post(
  '/drilling-chart',
  isAuth,
  [
    body('customer_idx').notEmpty().withMessage('회원 idx를 입력해 주세요.'),
    body('ball_name').notEmpty().withMessage('볼 이름을 입력해 주세요.'),
    body('weight').notEmpty().withMessage('무게를 입력해 주세요.'),
    body('driller_idx').notEmpty().withMessage('지공사를 선택해 주세요.'),
    validate,
  ],
  async (req, res) => {
    const { title, customer_idx, chart_data, ball_name, weight, driller_idx, hand, layout, pin, memo, user_idx } = req.body;
    console.log('chart_data', req.body);
    const foundChartNumber = await db
      .execute(`SELECT chart_number FROM drilling_chart WHERE customer_idx=${customer_idx} ORDER BY idx DESC`)
      .then((result) => (result[0].length > 0 ? result[0][0].chart_number : 0));
    console.log('마ㅣㅈ지막 넘버', foundChartNumber);
    await db.execute(
      'INSERT INTO drilling_chart ( user_idx, customer_idx, chart_number, chart_name, chart_data, ball_name, weight, driller_idx, hand, layout, pin, memo, created_time, updated_time ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      [
        user_idx ? user_idx : req.authorizedUser,
        customer_idx,
        foundChartNumber ? foundChartNumber + 1 : 1,
        title ? title : `지공차트${foundChartNumber ? foundChartNumber + 1 : 1}`,
        chart_data.join(','),
        ball_name,
        weight,
        driller_idx,
        hand ?? '',
        layout ?? '',
        pin ?? '',
        memo ?? '',
        new Date(),
        new Date(),
      ]
    );
    res.sendStatus(201);
  }
);

// 지공차트 목록
router.get(
  '/drilling-chart-list',
  isAuth,
  [query('customer_idx').notEmpty().withMessage('회원 idx를 입력해 주세요.'), validate],
  async (req, res) => {
    const { customer_idx, page } = req.query;
    console.log(req.body);
    const amount = req.query.amount ?? 10;
    const total = await db
      .execute(`SELECT COUNT(idx) AS total FROM drilling_chart WHERE customer_idx=${customer_idx}&&deleted_time IS NULL`)
      .then((result) => result[0][0].total);
    const chartList = await db
      .execute(
        `SELECT drilling_chart.idx, drilling_chart.customer_idx, drilling_chart.chart_number,drilling_chart.chart_name, drilling_chart.ball_name, drilling_chart.weight, drilling_chart.layout, drilling_chart.pin, driller.name AS driller, drilling_chart.memo, drilling_chart.created_time, drilling_chart.updated_time FROM drilling_chart JOIN driller ON drilling_chart.driller_idx=driller.idx WHERE drilling_chart.customer_idx=${customer_idx}&&drilling_chart.deleted_time IS NULL ORDER BY idx DESC LIMIT ${amount} OFFSET ${
          amount * (page - 1)
        }`
      )
      .then((result) => result[0]);
    console.log('데이터', chartList, '토탈', total);
    res.status(200).json({ total, chartList });
  }
);

// 지공차트 상세 & 회원 정보
router.get('/drilling-chart', isAuth, [query('idx').trim().notEmpty().withMessage('차트 idx를 입력해 주세요.'), validate], async (req, res) => {
  const { idx } = req.query;
  const chartDetails = await db
    .execute(
      `SELECT customer.name as name, customer.phone as phone, drilling_chart.* FROM customer JOIN drilling_chart ON customer.idx=drilling_chart.customer_idx WHERE drilling_chart.idx=${idx}`
    )
    .then((result) => result[0][0]);
  res.status(200).json({ ...chartDetails });
});

// 지공차트 수정
router.put(
  '/drilling-chart',
  isAuth,
  [
    body('ball_name').notEmpty().withMessage('볼 이름을 입력해 주세요.'),
    body('weight').notEmpty().withMessage('무게를 입력해 주세요.'),
    body('driller_idx').notEmpty().withMessage('지공사를 선택해 주세요.'),
    validate,
  ],
  async (req, res) => {
    const { chart_idx, chart_data, ball_name, weight, driller_idx, hand, layout, pin, memo } = req.body;
    await db.execute(
      'UPDATE drilling_chart SET chart_data=?, ball_name=?, weight=?, driller_idx=?, hand=?, layout=?, pin=?, memo=?, updated_time=? WHERE idx=?',
      [chart_data.join(','), ball_name, weight, driller_idx, hand, layout, pin, memo, new Date(), chart_idx]
    );
    res.sendStatus(204);
  }
);

// 지공차트 선택 삭제
router.post(
  '/drilling-chart-delete',
  isAuth,
  [body('idx').isLength({ min: 1 }).withMessage('지공차트 idx를 입력해 주세요.'), validate],
  async (req, res) => {
    const { idx } = req.body;
    await db.execute(`UPDATE drilling_chart SET deleted_time=? WHERE idx IN(${idx})`, [new Date()]);
    res.sendStatus(204);
  }
);

// 지공차트 제목 수정
router.put(
  '/drilling-chart-name',
  isAuth,
  [
    body('chart_idx').notEmpty().withMessage('차트 idx를 입력해 주세요.'),
    body('chart_name').notEmpty().withMessage('차트 이름을 입력해 주세요.'),
    validate,
  ],
  async (req, res) => {
    const { chart_idx, chart_name } = req.body;
    await db.execute('UPDATE drilling_chart SET chart_name=? WHERE idx=?', [chart_name, chart_idx]);
    res.sendStatus(204);
  }
);

export default router;
