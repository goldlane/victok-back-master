import dayjs from 'dayjs';
import express from 'express';
import multer from 'multer';
import { body, query } from 'express-validator';
import { db } from '../db/database.js';
import { isAuth, talkPush, validate } from '../middleware/functions.js';
import bcrypt from 'bcrypt';
import { config, URI } from '../../config.js';

const router = express.Router();

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'uploads/');
  },
  filename: function (req, file, cb) {
    cb(null, Date.now() + '_' + file.originalname);
  },
});
const upload = multer({ storage: storage });

// 가맹점 목록 & 검색
router.get('/store-list', isAuth, async (req, res) => {
  const { column, order, keyword, page } = req.query;
  const amount = req.query.amount ?? 10;
  const countMembership = await db
    .execute(`SELECT COUNT(store.idx) AS count FROM store JOIN user ON store.user_idx=user.idx WHERE user.grade=1&&user.deleted_time IS NULL`)
    .then((result) => result[0][0].count);
  const countFree = await db
    .execute(`SELECT COUNT(store.idx) AS count FROM store JOIN user ON store.user_idx=user.idx WHERE user.grade=0&&user.deleted_time IS NULL`)
    .then((result) => result[0][0].count);
  console.log('유료 회원 수', countMembership);
  if (!keyword) {
    const total = await db
      .execute(`SELECT COUNT(store.idx) AS total FROM store JOIN user ON store.user_idx=user.idx WHERE user.deleted_time IS NULL`)
      .then((result) => result[0][0].total);
    const list = await db
      .execute(
        `SELECT user.idx AS user_idx, user.created_time as created_time, user.name AS user_name, user.phone, user.grade, user.email, store.idx, store.type, store.name AS store_name, store.address1, store.address2, store.contact, group_concat(DISTINCT talk_dday.dday) as dday,(SELECT SUM(amount) FROM payment_history WHERE user.idx=user_idx GROUP BY user_idx ) as amount FROM user JOIN store ON store.user_idx=user.idx LEFT JOIN talk_dday ON user.idx=talk_dday.user_idx WHERE talk_dday.deleted_time IS NULL&&user.deleted_time IS NULL GROUP BY talk_dday.user_idx, user.idx, user.name,user.phone,user.email,store.idx,store.type,store.name,store.address1, store.address2, store.contact ORDER BY ${column} ${order} LIMIT ${amount} OFFSET ${
          amount * (page - 1)
        }`
      )
      .then((result) => result[0]);
    res.status(200).json({ total, list, countMembership, countFree });
  } else {
    const total = await db
      .execute(
        `SELECT COUNT(store.idx) AS total FROM store JOIN user ON store.user_idx=user.idx WHERE (user.name LIKE '%${keyword}%'||user.phone LIKE '%${keyword}%'||store.name LIKE '%${keyword}%')&&user.deleted_time IS NULL`
      )
      .then((result) => result[0][0].total);
    const list = await db
      .execute(
        `SELECT user.idx AS user_idx, user.created_time as created_time, user.name AS user_name, user.phone, user.grade, user.email, store.idx, store.type, store.name AS store_name, store.address1, store.address2, store.contact, group_concat(DISTINCT talk_dday.dday) as dday,(SELECT SUM(amount) FROM payment_history WHERE user.idx=user_idx GROUP BY user_idx ) as amount FROM user JOIN store ON store.user_idx=user.idx LEFT JOIN talk_dday ON user.idx=talk_dday.user_idx WHERE talk_dday.deleted_time IS NULL&&(user.name LIKE '%${keyword}%'||user.phone LIKE '%${keyword}%'||store.name LIKE '%${keyword}%')&&user.deleted_time IS NULL GROUP BY talk_dday.user_idx, user.idx, user.name,user.phone,user.email,store.idx,store.type,store.name,store.address1, store.address2, store.contact ORDER BY ${column} ${order} LIMIT ${amount} OFFSET ${
          amount * (page - 1)
        }`
      )
      .then((result) => result[0]);
    res.status(200).json({ total, list, countMembership, countFree });
  }
});

// 라커 구분 목록 - 요금표 포함
router.get('/locker-type', isAuth, async (req, res) => {
  const { page, user_idx } = req.query;
  const amount = req.query.amount ?? 10;
  const total = await db
    .execute(`SELECT COUNT(idx) AS total FROM locker_type WHERE user_idx=${user_idx}&&deleted_time IS NULL`)
    .then((result) => result[0][0].total);
  const list = await db
    .execute(
      `SELECT locker_type.idx as idx,locker_type.locker_type as locker_type,locker_type.start_number as start_number,locker_type.locker_amount as locker_amount, group_concat(DISTINCT talk_dday.dday) as dday FROM locker_type LEFT JOIN talk_dday ON locker_type.idx=talk_dday.locker_type_idx  WHERE talk_dday.deleted_time IS NULL&&locker_type.user_idx=${user_idx}&&locker_type.deleted_time IS NULL GROUP BY locker_type.idx ORDER BY idx LIMIT ${amount} OFFSET ${
        amount * (page - 1)
      }`
    )
    .then((result) => result[0]);
  console.log(list);
  const chargeList = await Promise.all(
    list.map(async (item) => {
      const charge = await db
        .execute(`SELECT idx, period, charge, deposit, period_type FROM charge WHERE locker_type_idx=${item.idx}&&deleted_time IS NULL`)
        .then((result) => result[0]);
      return { ...item, charge: charge };
    })
  );
  console.log(chargeList);
  const storeName = await db.execute(`SELECT name FROM store WHERE user_idx=${user_idx}`).then((result) => result[0][0].name);
  res.status(200).json({ total, chargeList, storeName });
});

// 라커 구분 등록
router.post(
  '/locker-type',
  isAuth,
  [
    body('locker_type').trim().notEmpty().withMessage('라커 타입을 입력해 주세요.'),
    body('locker_amount').trim().notEmpty().withMessage('라커 개수를 입력해 주세요.'),
    body('start_number').trim().notEmpty().withMessage('시작 번호를 입력해 주세요.'),
    body('user_idx').trim().notEmpty().withMessage('유저 idx를 입력해 주세요.'),
    body('talk_dday').isLength({ min: 1 }).withMessage('알림주기를 설정해 주세요.'),
    body('charge').isLength({ min: 1 }).withMessage('요금제를 등록해 주세요.'),
    validate,
  ],
  async (req, res) => {
    const { user_idx, locker_type, locker_amount, start_number, charge, talk_dday } = req.body;
    console.log(req.body);
    const foundType = await db
      .execute(`SELECT idx FROM locker_type WHERE user_idx=${user_idx}&&locker_type='${locker_type}'&&deleted_time IS NULL`)
      .then((result) => result[0][0]);
    if (foundType) {
      res.status(409).json({ message: '라커 타입 중복됨.' });
    } else {
      const result = await db.execute(
        'INSERT INTO locker_type (user_idx, locker_type, locker_amount, start_number, created_time) VALUES (?,?,?,?,?)',
        [user_idx, locker_type, locker_amount, start_number, new Date()]
      );
      console.log('리턴', result[0].insertId);
      const insertId = result[0].insertId;
      for (const i of charge) {
        console.log(i);
        await db.execute('INSERT INTO charge (locker_type_idx, period_type, period, charge, deposit) VALUES (?,?,?,?,?)', [
          insertId,
          Number(i.period_type),
          Number(i.period),
          Number(i.charge),
          Number(i.deposit),
        ]);
      }
      for (const i of talk_dday) {
        console.log(i);
        await db.execute('INSERT INTO talk_dday (user_idx, locker_type_idx, dday) VALUES (?,?,?)', [user_idx, insertId, Number(i)]);
      }
      res.sendStatus(201);
    }
  }
);

// 라커 구분 선택 삭제
router.post(
  '/locker-type-delete',
  isAuth,
  [body('idx').trim().notEmpty().withMessage('라커 타입 idx를 입력해 주세요.'), validate],
  async (req, res) => {
    console.log('asdasdasd', req.body);
    const user_idx = req.body.user_idx;
    const idx = req.body.idx.split(',');
    const date = dayjs().format('YYYY-MM-DD HH:mm:ss');
    const today = dayjs().format('YYYY-MM-DD');
    const list = [];
    for (const i of idx) {
      const locker = await db.execute(`SELECT * FROM locker_type WHERE idx=${i}`).then((result) => result[0][0]);
      console.log(locker);
      const findCustomer = await db
        .execute(
          `SELECT idx FROM locker WHERE user_idx=${user_idx}&&locker_type='${locker.locker_type}'&&end_date >='${today}'&& deleted_time IS NULL`
        )
        .then((result) => result[0][0]);
      console.log('findCustomer', findCustomer);
      if (findCustomer) {
        return res.status(409).json({ message: `${locker.locker_type}에 이용중인 사용자가 있습니다.` });
      }
    }
    await db.execute(`UPDATE locker_type SET deleted_time='${date}' WHERE idx IN(${idx})`);
    res.sendStatus(204);
  }
);

// 라커 구분 수정
router.put(
  '/locker-type',
  isAuth,
  [
    body('user_idx').trim().notEmpty().withMessage('유저 idx를 입력해 주세요.'),
    body('locker_type_idx').trim().notEmpty().withMessage('라커 타입 idx를 입력해 주세요.'),
    body('locker_type').trim().notEmpty().withMessage('라커 타입을 입력해 주세요.'),
    body('locker_amount').trim().notEmpty().withMessage('라커 개수를 입력해 주세요.'),
    body('start_number').trim().notEmpty().withMessage('시작 번호를 입력해 주세요.'),
    body('talk_dday').isLength({ min: 1 }).withMessage('알림주기를 설정해 주세요.'),
    body('charge').isLength({ min: 1 }).withMessage('요금제를 입력해 주세요.'),
    validate,
  ],
  async (req, res) => {
    const { user_idx, locker_type_idx, locker_type, locker_amount, start_number, charge, talk_dday } = req.body;
    const foundType = await db
      .execute(`SELECT * FROM locker_type WHERE user_idx=${user_idx}&&locker_type='${locker_type}'&&idx!=${locker_type_idx}&&deleted_time IS NULL`)
      .then((result) => result[0][0]);
    if (foundType && foundType.locker_type !== locker_type) {
      res.status(409).json({ message: '라커 구분명이 중복됩니다.' });
    } else {
      const beforeType = await db.execute(`SELECT * FROM locker_type WHERE idx=${locker_type_idx}`).then((result) => result[0][0]);
      const foundCustomer = await db
        .execute(
          `SELECT * FROM locker WHERE user_idx=${user_idx}&&deleted_time IS NULL&&(locker_number<${start_number}||locker_number>(${start_number}+${locker_amount}-1))&&locker_type='${beforeType.locker_type}'`
        )
        .then((result) => result[0][0]);
      if (foundCustomer) {
        console.log(foundCustomer);
        return res.status(409).json({ message: '설정한 라커번호 범위 내에서 벗어나는 고객이 등록 되어 있습니다.' });
      }
      await db.execute('UPDATE locker_type SET locker_type=?, locker_amount=?, start_number=?, updated_time=? WHERE idx=?', [
        locker_type,
        locker_amount,
        start_number,
        new Date(),
        locker_type_idx,
      ]);
      await db.execute('UPDATE locker SET locker_type=? WHERE user_idx=? && locker_type=? && deleted_time IS NULL', [
        locker_type,
        user_idx,
        beforeType.locker_type,
      ]);
      await db.execute('UPDATE charge SET deleted_time=? WHERE locker_type_idx=?', [new Date(), locker_type_idx]);
      for (const i of charge) {
        console.log(i);
        await db.execute('INSERT INTO charge (locker_type_idx, period_type, period, charge,deposit) VALUES (?,?,?,?,?)', [
          locker_type_idx,
          Number(i.period_type),
          Number(i.period),
          Number(i.charge),
          Number(i.deposit),
        ]);
      }
      await db.execute('UPDATE talk_dday SET deleted_time=? WHERE locker_type_idx=?', [new Date(), locker_type_idx]);
      for (const i of talk_dday) {
        console.log(i);
        await db.execute('INSERT INTO talk_dday (user_idx, locker_type_idx, dday) VALUES (?,?,?)', [user_idx, locker_type_idx, Number(i)]);
      }
      res.sendStatus(201);
    }
  }
);

// 가맹점 정보 불러오기
router.get('/store', isAuth, [query('user_idx').trim().notEmpty().withMessage('회원(가맹점주) idx를 입력해 주세요.'), validate], async (req, res) => {
  const { user_idx } = req.query;
  const list = await db
    .execute(
      `SELECT user.name AS user_name, user.phone, user.email, store.type, store.name AS store_name, store.address1, store.address2, store.contact FROM store JOIN user ON store.user_idx=user.idx WHERE store.user_idx=${user_idx}&&user.deleted_time IS NULL`
    )
    .then((result) => result[0]);
  res.status(200).json(list);
});

// 라커 전체 목록 & 검색 (항목별 오름차순/내림차순 정렬) - 리스트
router.get(
  '/locker-list',
  isAuth,
  [
    query('user_idx').trim().notEmpty().withMessage('user_idx를 입력해 주세요.'),
    query('column').trim().notEmpty().withMessage('정렬할 항목을 입력해 주세요.'),
    query('order').trim().notEmpty().withMessage('정렬 방식을 입력해 주세요.'),
    validate,
  ],
  async (req, res) => {
    const { user_idx, column, order, keyword, page } = req.query;
    console.log(req.query);
    const amount = req.query.amount ?? 10;
    if (!keyword) {
      const total = await db
        .execute(
          `SELECT COUNT(locker.idx) AS total FROM (SELECT MAX(idx) AS idx FROM locker WHERE locker.user_idx=${user_idx} && locker.customer_idx IS NOT NULL group by locker_type,locker_number) locker_idx JOIN locker ON locker_idx.idx=locker.idx WHERE locker.deleted_time IS NULL`
        )
        .then((result) => result[0][0].total);

      const list = await db
        .execute(
          `SELECT charge.charge, charge.period, charge.deposit, charge.period_type, locker.idx,locker.user_idx,locker.customer_idx,locker.locker_number,locker.locker_type,locker.start_date,locker.end_date,locker.used,locker.remain,locker.paid, locker.deleted_time AS deleted_time,customer.name,customer.phone FROM (SELECT MAX(idx) as idx from locker WHERE locker.user_idx=${user_idx} && locker.customer_idx IS NOT NULL GROUP BY locker.locker_type, locker.locker_number) locker_idx JOIN locker on locker.idx = locker_idx.idx LEFT JOIN customer ON locker.customer_idx=customer.idx LEFT JOIN charge ON locker.charge=charge.idx WHERE locker.deleted_time IS NULL ORDER BY ${column} ${order} LIMIT ${amount} OFFSET ${
            amount * (page - 1)
          }`
        )
        .then((result) => result[0]);
      const lockerCount = await db
        .execute(`SELECT SUM(locker_amount) AS lockerCount FROM locker_type WHERE user_idx=${user_idx}&&deleted_time IS NULL`)
        .then((result) => result[0][0].lockerCount);
      const expiredCount = await db
        .execute(
          `SELECT COUNT(locker.idx) AS expiredCount FROM (select max(idx) as idx from locker WHERE locker.user_idx=${user_idx}  && locker.customer_idx IS NOT NULL group by locker_type,locker_number) locker_idxs JOIN locker ON locker.idx=locker_idxs.idx WHERE locker.remain=-1&&locker.deleted_time IS NULL`
        )
        .then((result) => result[0][0].expiredCount);
      return res.status(200).json({ total, list, allCount: total, lockerCount, expiredCount });
    } else {
      const total = await db
        .execute(
          `SELECT COUNT(locker.idx) AS total FROM (SELECT MAX(idx) AS idx FROM locker WHERE locker.user_idx=${user_idx} && locker.customer_idx IS NOT NULL group by locker_type,locker_number) locker_idxs JOIN locker ON locker.idx = locker_idxs.idx JOIN customer ON locker.customer_idx = customer.idx  WHERE (customer.name LIKE \'%${keyword}%\'||customer.phone LIKE \'%${keyword}%\'||customer.memo LIKE \'%${keyword}%\')&&locker.deleted_time IS NULL`
        )
        .then((result) => result[0][0].total);
      const allCount = await db
        .execute(
          `SELECT COUNT(locker.idx) AS total FROM (select max(idx) as idx from locker WHERE locker.user_idx=${user_idx} && locker.customer_idx IS NOT NULL group by locker_type,locker_number) locker_idxs JOIN locker ON locker.idx=locker_idxs.idx WHERE locker.deleted_time IS NULL`
        )
        .then((result) => result[0][0].total);
      const list = await db
        .execute(
          `SELECT charge.charge, charge.period, charge.deposit, charge.period_type, locker.idx,locker.user_idx,locker.customer_idx,locker.locker_number,locker.locker_type,locker.start_date,locker.end_date,locker.used,locker.remain,locker.paid, locker.deleted_time AS deleted_time,customer.name,customer.phone FROM (SELECT MAX(idx) as idx from locker WHERE locker.user_idx=${user_idx} && locker.customer_idx IS NOT NULL GROUP BY locker.locker_type, locker.locker_number) locker_idx JOIN locker on locker.idx = locker_idx.idx LEFT JOIN customer ON locker.customer_idx=customer.idx JOIN charge ON locker.charge=charge.idx WHERE (customer.name LIKE \'%${keyword}%\'||customer.phone LIKE \'%${keyword}%\'||customer.memo LIKE \'%${keyword}%\')&&locker.deleted_time IS NULL ORDER BY ${column} ${order} LIMIT ${amount} OFFSET ${
            amount * (page - 1)
          }`
        )
        .then((result) => result[0]);
      const lockerCount = await db
        .execute(`SELECT SUM(locker_amount) AS lockerCount FROM locker_type WHERE user_idx=${user_idx}&&deleted_time IS NULL`)
        .then((result) => result[0][0].lockerCount);
      const expiredCount = await db
        .execute(
          `SELECT COUNT(locker.idx) AS expiredCount FROM (select max(idx) as idx from locker WHERE locker.user_idx=${user_idx} && locker.customer_idx IS NOT NULL group by locker_type,locker_number) locker_idxs JOIN locker ON locker.idx=locker_idxs.idx WHERE locker.remain=-1&&locker.deleted_time IS NULL`
        )
        .then((result) => result[0][0].expiredCount);
      return res.status(200).json({ total, list, allCount, lockerCount, expiredCount });
    }
  }
);

// 라커 구분 목록 - 요금표 포함 (페이지네이션 없는 것)
router.post('/locker-type-all', isAuth, async (req, res) => {
  const { user_idx } = req.body;
  const list = await db
    .execute(`SELECT * FROM locker_type WHERE user_idx=${user_idx}&&deleted_time IS NULL ORDER BY idx`)
    .then((result) => result[0]);
  const chargeList = await Promise.all(
    list.map(async (item) => {
      const charge = await db
        .execute(`SELECT idx, period, charge,deposit,period_type FROM charge WHERE locker_type_idx=${item.idx}&&deleted_time IS NULL`)
        .then((result) => result[0]);
      return { ...item, charge: charge };
    })
  );
  res.status(200).json({ chargeList });
});

// 라커 타입별 전체 목록 - 배열
router.post('/locker-array', isAuth, async (req, res) => {
  const { user_idx, locker_type } = req.body;
  const date = dayjs().subtract(1, 'day').format('YYYY-MM-DD');
  const list = await db
    .execute(
      `SELECT locker.remain, locker.idx, locker.customer_idx,locker.locker_number,locker.locker_type,locker.start_date,locker.end_date, locker.available, customer.name FROM locker LEFT JOIN customer ON locker.customer_idx=customer.idx WHERE locker.user_idx=${user_idx}&&locker.locker_type='${locker_type}'&&locker.deleted_time IS NULL&&locker.end_date>'${date}' ORDER BY locker_number`
    )
    .then((result) => result[0]);
  return res.status(200).json({ list });
});

// 라커(이용자) 추가
router.post(
  '/locker',
  isAuth,
  [
    body('user_idx').trim().notEmpty().withMessage('user_idx를 입력해 주세요.'),
    body('customer_name').trim().notEmpty().withMessage('사용자 이름을 입력해 주세요.'),
    body('customer_phone').trim().notEmpty().withMessage('사용자 휴대폰 번호를 입력해 주세요.'),
    body('locker_type').trim().notEmpty().withMessage('라커 구분을 입력해 주세요.'),
    body('locker_number').trim().notEmpty().withMessage('라커 번호를 입력해 주세요.'),
    body('start_date').trim().notEmpty().withMessage('시작일을 입력해 주세요.'),
    body('end_date').trim().notEmpty().withMessage('종료일을 입력해 주세요.'),
    body('charge').trim().notEmpty().withMessage('요금을 입력해 주세요.'),
    body('paid').trim().notEmpty().withMessage('수납 여부를 입력해 주세요.'),
    validate,
  ],
  async (req, res) => {
    const { user_idx, customer_name, customer_phone, locker_type, locker_number, start_date, end_date, charge, paid, memo = '' } = req.body;
    const today = dayjs().format('YYYY-MM-DD');
    const used =
      dayjs(today).diff(start_date, 'day') >= 0
        ? dayjs(end_date).diff(dayjs(today), 'day') >= 0
          ? dayjs(today).diff(dayjs(start_date), 'day') + 1
          : dayjs(end_date).diff(dayjs(start_date), 'day') + 1
        : 0;
    const remain =
      dayjs(today).diff(start_date, 'day') >= 0 ? dayjs(end_date).diff(dayjs(today), 'day') : dayjs(end_date).diff(dayjs(start_date), 'day') + 1;
    const foundCustomer = await db
      .execute(`SELECT idx FROM customer WHERE user_idx=${user_idx} && name='${customer_name}'&&phone='${customer_phone}'`)
      .then((result) => result[0][0]);

    if (!foundCustomer) {
      const result = await db.execute('INSERT INTO customer (user_idx, name, phone, created_time ) VALUES (?,?,?,?)', [
        user_idx,
        customer_name,
        customer_phone,
        new Date(),
      ]);

      const customer_idx = result[0].insertId;
      await db.execute(
        'INSERT INTO locker ( user_idx, customer_idx, locker_type, locker_number, start_date, end_date, charge, paid, created_time, used, remain) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
        [user_idx, customer_idx, locker_type, locker_number, start_date, end_date, charge, paid, new Date(), used, remain]
      );
      const price = await db.execute(`SELECT charge FROM charge WHERE idx=${charge}`).then((result) => result[0][0].charge);
      await db.execute(
        'INSERT INTO locker_log ( type, user_idx, customer_idx, locker_type, locker_number, start_date, end_date, charge, handled_time) VALUES (?,?,?,?,?,?,?,?,?)',
        ['라카 이용자 추가 (관리자)', user_idx, customer_idx, locker_type, locker_number, start_date, end_date, price, new Date()]
      );
      res.sendStatus(201);
    } else {
      await db.execute(`UPDATE customer SET memo='${memo}' WHERE idx=${foundCustomer.idx}`);
      await db.execute(
        'INSERT INTO locker ( user_idx, customer_idx, locker_type, locker_number, start_date, end_date, charge, paid, created_time, used, remain) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
        [user_idx, foundCustomer.idx, locker_type, locker_number, start_date, end_date, charge, paid, new Date(), used, remain]
      );
      const price = await db.execute(`SELECT charge FROM charge WHERE idx=${charge}`).then((result) => result[0][0].charge);
      await db.execute(
        'INSERT INTO locker_log ( type, user_idx, customer_idx, locker_type, locker_number, start_date, end_date, charge, handled_time) VALUES (?,?,?,?,?,?,?,?,?)',
        ['라카 이용자 추가 (관리자)', user_idx, foundCustomer.idx, locker_type, locker_number, start_date, end_date, price, new Date()]
      );
      res.sendStatus(201);
    }
  }
);

// 라커 수리중 설정
router.put(
  '/locker-fix',
  isAuth,
  [
    body('user_idx').trim().notEmpty().withMessage('user_idx를 입력해 주세요.'),
    body('locker_type').trim().notEmpty().withMessage('라커 타입을 입력해 주세요.'),
    body('locker_number').trim().notEmpty().withMessage('라커 넘버를 입력해 주세요.'),
    validate,
  ],
  async (req, res) => {
    const { user_idx, locker_type, locker_number } = req.body;
    const lockerInfo = await db
      .execute(
        `SELECT * FROM locker WHERE user_idx=${user_idx}&&locker_type='${locker_type}'&&locker_number='${locker_number}'&&deleted_time IS NULL`
      )
      .then((result) => result[0][0]);
    console.log(lockerInfo);
    if (lockerInfo) {
      await db.execute(
        `UPDATE locker SET available=0 WHERE user_idx=${user_idx}&&locker_type='${locker_type}'&&locker_number='${locker_number}'&&deleted_time IS NULL`
      );
      res.sendStatus(204);
    } else {
      await db.execute(
        'INSERT INTO locker (user_idx, locker_type, locker_number, start_date, end_date, paid, created_time, available) VALUES (?,?,?,?,?,?,?,?)',
        [user_idx, locker_type, locker_number, new Date(), '9999-12-31', '미수납', new Date(), 0]
      );
      res.sendStatus(204);
    }
  }
);

// 라커 이용가능 설정
router.put(
  '/locker-available',
  isAuth,
  [
    body('user_idx').trim().notEmpty().withMessage('user_idx를 입력해 주세요.'),
    body('locker_type').trim().notEmpty().withMessage('라커 타입을 입력해 주세요.'),
    body('locker_number').trim().notEmpty().withMessage('라커 넘버를 입력해 주세요.'),
    validate,
  ],
  async (req, res) => {
    const { user_idx, locker_type, locker_number } = req.body;
    const lockerInfo = await db
      .execute(
        `SELECT * FROM locker WHERE user_idx=${user_idx}&&locker_type='${locker_type}'&&locker_number='${locker_number}'&&available=0&&deleted_time IS NULL`
      )
      .then((result) => result[0][0]);
    console.log(lockerInfo);
    if (lockerInfo.customer_idx) {
      await db.execute(
        `UPDATE locker SET available=1 WHERE user_idx=${user_idx}&&locker_type='${locker_type}'&&locker_number='${locker_number}'&&deleted_time IS NULL`
      );
      res.sendStatus(204);
    } else {
      const date = dayjs().format('YYYY-MM-DD HH:mm:ss');
      await db.execute(
        `UPDATE locker SET deleted_time='${date}' WHERE user_idx=${user_idx}&&locker_type='${locker_type}'&&locker_number='${locker_number}'&&deleted_time IS NULL`
      );
      res.sendStatus(204);
    }
  }
);

// 이용자 목록 & 검색
router.get('/customer-list-active', isAuth, async (req, res) => {
  const { keyword, page, column, order } = req.query;
  console.log(req.query);
  const amount = req.query.amount ?? 10;
  if (!keyword) {
    const date = dayjs().format('YYYY-MM-DD');
    const total = await db
      .execute(
        `SELECT customer.idx, customer.name, customer.phone,COUNT(locker.customer_idx) as count FROM customer JOIN locker ON customer.idx=locker.customer_idx WHERE locker.end_date>='${date}'&&locker.deleted_time IS NULL GROUP BY customer.idx`
      )
      .then((result) => result[0]);
    const list = await db
      .execute(
        `SELECT customer.idx, customer.name, customer.phone,COUNT(locker.customer_idx) as count FROM customer JOIN locker ON customer.idx=locker.customer_idx WHERE locker.end_date>='${date}'&&locker.deleted_time IS NULL GROUP BY customer.idx ORDER BY ${column} ${order} LIMIT ${amount} OFFSET ${
          amount * (page - 1)
        }`
      )
      .then((result) => result[0]);

    res.status(200).json({ total: total.length, list: list });
  } else {
    const date = dayjs().format('YYYY-MM-DD');
    const total = await db
      .execute(
        `SELECT customer.idx, customer.name, customer.phone,COUNT(locker.customer_idx) as count FROM customer JOIN locker ON customer.idx=locker.customer_idx WHERE (customer.name LIKE \'%${keyword}%\'||customer.phone LIKE \'%${keyword}%\')&&locker.end_date>='${date}'&&locker.deleted_time IS NULL GROUP BY customer.idx`
      )
      .then((result) => result[0]);
    const list = await db
      .execute(
        `SELECT customer.idx, customer.name, customer.phone,COUNT(locker.customer_idx) as count FROM customer JOIN locker ON customer.idx=locker.customer_idx WHERE (customer.name LIKE \'%${keyword}%\'||customer.phone LIKE \'%${keyword}%\')&&locker.end_date>='${date}'&&locker.deleted_time IS NULL GROUP BY customer.idx ORDER BY ${column} ${order} LIMIT ${amount} OFFSET ${
          amount * (page - 1)
        }`
      )
      .then((result) => result[0]);

    res.status(200).json({ total: total.length, list: list });
  }
});

// 이용자 라커 상세
router.get(
  '/customer-locker-list',
  isAuth,
  [query('customer_idx').trim().notEmpty().withMessage('사용자 idx를 입력해 주세요.'), validate],
  async (req, res) => {
    const { customer_idx, page } = req.query;
    const amount = req.query.amount ?? 10;
    const date = dayjs().format('YYYY-MM-DD');
    const customerName = await db.execute(`SELECT name FROM customer WHERE idx=${customer_idx}`).then((result) => result[0][0].name);
    console.log(customerName);
    const total = await db
      .execute(
        `SELECT COUNT(locker.idx) AS total FROM locker LEFT JOIN locker_type ON locker.locker_type=locker_type.locker_type&&locker.user_idx=locker_type.user_idx JOIN store ON locker_type.user_idx=store.user_idx JOIN charge ON locker.charge=charge.idx JOIN customer ON locker.customer_idx=customer.idx WHERE locker.customer_idx=${customer_idx}&&locker.end_date>='${date}'&&locker.deleted_time IS NULL`
      )
      .then((result) => result[0][0].total);
    const list = await db
      .execute(
        `SELECT customer.name AS customer_name, customer.phone , charge.charge, store.type, store.name AS store_name, locker.locker_type, locker.locker_number, locker.start_date, locker.end_date, locker.paid, locker.used, locker.remain FROM locker LEFT JOIN locker_type ON locker.locker_type=locker_type.locker_type&&locker.user_idx=locker_type.user_idx JOIN store ON locker_type.user_idx=store.user_idx JOIN charge ON locker.charge=charge.idx JOIN customer ON locker.customer_idx=customer.idx WHERE locker.customer_idx=${customer_idx}&&locker.end_date>='${date}'&&locker.deleted_time IS NULL LIMIT ${amount} OFFSET ${
          amount * (page - 1)
        }`
      )
      .then((result) => result[0]);
    res.status(200).json({ total: total, list: list, customerName: customerName });
  }
);

// 전체 회원 목록 & 검색
router.get('/customer-list', isAuth, async (req, res) => {
  const { keyword, page } = req.query;
  const amount = req.query.amount ?? 10;
  if (!keyword) {
    const date = dayjs().format('YYYY-MM-DD');
    const total = await db
      .execute(`SELECT COUNT(name) AS total FROM (SELECT name,phone FROM customer WHERE deleted_time IS NULL GROUP BY name,phone) C`)
      .then((result) => result[0][0].total);
    const list = await db
      .execute(
        `SELECT nc.name as name,nc.phone as phone, nc.store as store, (select count(idx) from locker where FIND_IN_SET(customer_idx,nc.idxs) && locker.deleted_time IS NULL && remain > -1) as locker, (select count(idx) from drilling_chart where FIND_IN_SET(customer_idx,nc.idxs) && drilling_chart.deleted_time IS NULL) as drilling_chart FROM (SELECT MIN(idx) as idx, GROUP_CONCAT(c.idx) as idxs, c.name, c.phone, GROUP_CONCAT(c.store) as store FROM (SELECT customer.*,store.name as store FROM customer JOIN user ON customer.user_idx = user.idx JOIN store ON store.user_idx=user.idx WHERE customer.deleted_time IS NULL ) c GROUP BY c.name, c.phone) nc ORDER BY nc.idx DESC LIMIT ${amount} OFFSET ${
          amount * (page - 1)
        }
      `
      )
      .then((result) => result[0]);
    console.log(list);
    res.status(200).json({ total, list });
  } else {
    const date = dayjs().format('YYYY-MM-DD');
    const total = await db
      .execute(
        `SELECT COUNT(name) AS total FROM (SELECT phone,name FROM customer WHERE (name LIKE \'%${keyword}%\'||phone LIKE \'%${keyword}%\')&&deleted_time IS NULL GROUP BY name,phone) C`
      )
      .then((result) => result[0][0].total);
    const list = await db
      .execute(
        `SELECT nc.name as name,nc.phone as phone, nc.store as store, (select count(idx) from locker where FIND_IN_SET(customer_idx,nc.idxs) && locker.deleted_time IS NULL && remain > -1) as locker, (select count(idx) from drilling_chart where FIND_IN_SET(customer_idx,nc.idxs) && drilling_chart.deleted_time IS NULL) as drilling_chart FROM (SELECT MIN(idx) as idx, GROUP_CONCAT(c.idx) as idxs, c.name, c.phone, GROUP_CONCAT(c.store) as store FROM (SELECT customer.*,store.name as store FROM customer JOIN user ON customer.user_idx = user.idx JOIN store ON store.user_idx=user.idx WHERE customer.deleted_time IS NULL && (customer.name LIKE \'%${keyword}%\'||customer.phone LIKE \'%${keyword}%\')) c GROUP BY c.name, c.phone) nc ORDER BY nc.idx DESC LIMIT ${amount} OFFSET ${
          amount * (page - 1)
        }`
      )
      .then((result) => result[0]);

    res.status(200).json({ total, list });
  }
});

// 전체 회원 라커 목록
router.get(
  '/all-customer-locker-list',
  isAuth,
  [
    query('name').trim().notEmpty().withMessage('이름을 입력해 주세요.'),
    query('phone').trim().notEmpty().withMessage('핸드폰 번호를 입력해 주세요.'),
    validate,
  ],
  async (req, res) => {
    const { column, order, name, phone } = req.query;
    if (column === 'none') {
      const list = await db
        .execute(
          `SELECT customer.name AS customer_name, customer.phone , charge.charge, charge.period, charge.period_type, charge.deposit, store.type, store.name AS store_name, locker.locker_type, locker.locker_number, locker.start_date, locker.end_date, locker.paid, locker.used, locker.remain, locker.deleted_time FROM locker JOIN store ON locker.user_idx=store.user_idx JOIN charge ON locker.charge=charge.idx JOIN customer ON locker.customer_idx=customer.idx WHERE customer.name='${name}'&&customer.phone='${phone}' ORDER BY (CASE WHEN locker.remain > -1 AND locker.deleted_time IS NULL THEN 1 ELSE 2 END),store.name, store.name ASC`
        )
        .then((result) => result[0]);
      console.log('초기 리스트트트트트트', list);
      res.status(200).json(list);
    } else {
      const list = await db
        .execute(
          `SELECT customer.name AS customer_name, customer.phone , charge.charge, charge.period, charge.period_type, charge.deposit, store.type, store.name AS store_name, locker.locker_type, locker.locker_number, locker.start_date, locker.end_date, locker.paid, locker.used, locker.remain, locker.deleted_time FROM locker JOIN store ON locker.user_idx=store.user_idx JOIN charge ON locker.charge=charge.idx JOIN customer ON locker.customer_idx=customer.idx WHERE customer.name='${name}'&&customer.phone='${phone}' ORDER BY ${column} ${order}`
        )
        .then((result) => result[0]);
      console.log('정렬 리스트트트트트트', list);
      res.status(200).json(list);
    }
  }
);

// 이용약관 & FAQ & 환불정책 링크 설정
router.put(
  '/terms',
  isAuth,
  [
    body('link1').trim().notEmpty().withMessage('이용약관 주소를 입력해 주세요.'),
    body('link2').trim().notEmpty().withMessage('개인정보처리방침 주소를 입력해 주세요.'),
    body('link3').trim().notEmpty().withMessage('FAQ 주소를 입력해 주세요.'),
    body('link4').trim().notEmpty().withMessage('취소환불정책 주소를 입력해 주세요.'),
    validate,
  ],
  async (req, res) => {
    const { link1, link2, link3, link4 } = req.body;
    await db.execute('UPDATE setting SET terms_of_use=?, privacy_policy=?, faq=?, refund_policy=? WHERE idx=1', [link1, link2, link3, link4]);
    res.sendStatus(204);
  }
);

// 관리자 비밀번호 변경
router.put(
  '/password',
  isAuth,
  [body('new_password').trim().notEmpty().withMessage('새로운 비밀번호를 입력해 주세요.'), validate],
  async (req, res) => {
    const { new_password } = req.body;
    const hashedPassword = await bcrypt.hash(new_password, config.bcrypt.saltRounds);
    await db.execute('UPDATE user SET password=? WHERE idx=?', [hashedPassword, req.authorizedUser]);
    res.sendStatus(204);
  }
);

// 라커 관리 로그
router.get('/locker-log', isAuth, async (req, res) => {
  const { column, order, keyword, page } = req.query;
  console.log(page);
  const amount = req.query.amount ?? 10;
  if (!keyword) {
    const total = await db
      .execute(
        `SELECT COUNT(locker_log.idx) AS total FROM locker_log JOIN store ON locker_log.user_idx=store.user_idx JOIN customer ON locker_log.customer_idx=customer.idx`
      )
      .then((result) => result[0][0].total);
    const list = await db
      .execute(
        `SELECT store.type AS store_type, store.name AS store_name, customer.name AS customer_name, customer.phone AS customer_phone, locker_log.*  FROM locker_log JOIN store ON locker_log.user_idx=store.user_idx JOIN customer ON locker_log.customer_idx=customer.idx ORDER BY ${column} ${order} LIMIT ${amount} OFFSET ${
          amount * (page - 1)
        }`
      )
      .then((result) => result[0]);
    res.status(200).json({ total, list });
  } else {
    const total = await db
      .execute(
        `SELECT COUNT(locker_log.idx) AS total FROM locker_log JOIN store ON locker_log.user_idx=store.user_idx JOIN customer ON locker_log.customer_idx=customer.idx WHERE (customer.name LIKE \'%${keyword}%\'||customer.phone LIKE \'%${keyword}%\'||store.name LIKE \'%${keyword}%\')`
      )
      .then((result) => result[0][0].total);
    const list = await db
      .execute(
        `SELECT store.type AS store_type, store.name AS store_name, customer.name AS customer_name, customer.phone AS customer_phone, locker_log.*  FROM locker_log JOIN store ON locker_log.user_idx=store.user_idx JOIN customer ON locker_log.customer_idx=customer.idx WHERE (customer.name LIKE \'%${keyword}%\'||customer.phone LIKE \'%${keyword}%\'||store.name LIKE \'%${keyword}%\') ORDER BY ${column} ${order} LIMIT ${amount} OFFSET ${
          amount * (page - 1)
        }`
      )
      .then((result) => result[0]);
    res.status(200).json({ total, list });
  }
});

// 카카오 알림톡 로그
router.get('/talk-log', isAuth, async (req, res) => {
  const { page } = req.query;
  console.log(page);
  const amount = req.query.amount ?? 10;
  const total = await db.execute(`SELECT COUNT(idx) AS total FROM talk_log`).then((result) => result[0][0].total);
  const list = await db.execute(`SELECT * FROM talk_log ORDER BY idx DESC LIMIT ${amount} OFFSET ${amount * (page - 1)}`).then((result) => result[0]);
  res.status(200).json({ total, list });
});

// 지공차트 목록
router.get(
  '/drilling-chart-list',
  isAuth,
  [query('name').notEmpty().withMessage('이름을 입력해 주세요.'), query('phone').notEmpty().withMessage('핸드폰 번호를 입력해 주세요.'), validate],
  async (req, res) => {
    const { name, phone } = req.query;
    const chartList = await db
      .execute(
        `SELECT store.type, store.name, drilling_chart.idx, drilling_chart.customer_idx, drilling_chart.chart_number, drilling_chart.chart_name, drilling_chart.ball_name, drilling_chart.weight, drilling_chart.layout, drilling_chart.pin, driller.name AS driller, drilling_chart.memo, drilling_chart.created_time, drilling_chart.updated_time FROM drilling_chart JOIN driller ON drilling_chart.driller_idx=driller.idx JOIN store ON drilling_chart.user_idx=store.user_idx JOIN customer ON drilling_chart.customer_idx=customer.idx WHERE customer.name='${name}'&&customer.phone='${phone}'&&drilling_chart.deleted_time IS NULL ORDER BY idx DESC`
      )
      .then((result) => result[0]);
    res.status(200).json(chartList);
  }
);

// 지공사 목록
router.get('/driller', isAuth, async (req, res) => {
  const { idx } = req.query;
  console.log(idx);
  const user_idx = await db.execute(`SELECT * FROM drilling_chart WHERE idx=${idx}`).then((result) => result[0][0].user_idx);
  const driller = await db.execute(`SELECT * FROM driller WHERE user_idx=${user_idx} `).then((result) => result[0]);
  res.status(200).json(driller);
});

// 이용권 정보 불러오기
router.get('/payment-setting', isAuth, async (req, res) => {
  const paymentInfo = await db.execute(`SELECT name, amount FROM payment_setting WHERE idx=1`).then((result) => result[0][0]);
  res.status(200).json(paymentInfo);
});

// 이용권 정보 설정
router.put(
  '/payment-setting',
  isAuth,
  [
    body('name').trim().notEmpty().withMessage('상품명을 입력해 주세요.'),
    body('amount').trim().notEmpty().withMessage('금액을 입력해 주세요.'),
    validate,
  ],
  async (req, res) => {
    const { name, amount } = req.body;
    await db.execute(`UPDATE payment_setting SET name='${name}', amount=${amount} WHERE idx=1`);
    res.sendStatus(204);
  }
);

// 결제 현황 & 결제 내역
router.get('/payment', isAuth, async (req, res) => {
  const { start_date, end_date, keyword, page } = req.query;
  console.log(req.query);
  const amount = req.query.amount ?? 10;

  // -> 결제 현황
  const total = await db
    .execute(
      `SELECT SUM(amount) AS totalAmount, COUNT(idx) AS totalCount,(SELECT SUM(payment_refund.amount) FROM payment_refund JOIN payment_history ON payment_refund.idx=payment_history.refund_idx WHERE payment_history.refund_idx IS NOT NULL) as totalRefund FROM payment_history`
    )
    .then((result) => result[0][0]);
  const totalData = {
    totalAmount: total.totalAmount ? total.totalAmount : 0,
    totalCount: total.totalCount ? total.totalCount : 0,
    totalRefund: total.totalRefund ? total.totalRefund : 0,
  };

  // -> 결제 내역(기간 검색)
  if (!(start_date && end_date)) {
    if (!keyword) {
      const total = await db
        .execute(
          `SELECT COUNT(payment_history.idx) AS total FROM payment_history LEFT JOIN user ON payment_history.user_idx=user.idx LEFT JOIN store ON store.user_idx=user.idx LEFT JOIN payment_refund ON payment_history.refund_idx=payment_refund.idx`
        )
        .then((result) => result[0][0].total);
      const paymentList = await db
        .execute(
          `SELECT payment_history.idx AS paymentIdx, store.type AS storeType, store.name AS storeName, user.name AS userName, payment_history.paid_time, payment_history.amount AS paymentAmount, payment_refund.amount AS refundAmount, payment_refund.memo AS refundMemo, (SELECT COUNT(idx) FROM talk_log where user.idx=talk_log.user_idx group by user_idx ) AS talkCount FROM payment_history LEFT JOIN user ON payment_history.user_idx=user.idx LEFT JOIN store ON store.user_idx=user.idx LEFT JOIN payment_refund ON payment_history.refund_idx=payment_refund.idx ORDER BY payment_history.idx DESC LIMIT ${amount} OFFSET ${
            amount * (page - 1)
          }`
        )
        .then((result) => result[0]);

      const sumData = await db
        .execute(
          `SELECT (SELECT COUNT(talk_log.idx) FROM payment_history LEFT JOIN user ON payment_history.user_idx=user.idx LEFT JOIN store ON store.user_idx=user.idx LEFT JOIN talk_log ON talk_log.user_idx=user.idx ) AS totalTalk, sum(payment_history.amount) as totalAmount, sum(payment_refund.amount) as totalRefund FROM payment_history LEFT JOIN user ON payment_history.user_idx=user.idx LEFT JOIN store ON store.user_idx=user.idx LEFT JOIN payment_refund ON payment_history.refund_idx=payment_refund.idx`
        )
        .then((result) => result[0][0]);
      res.status(200).json({ totalData, paymentList, total, sumData });
    } else {
      const total = await db
        .execute(
          `SELECT COUNT(payment_history.idx) AS total FROM payment_history LEFT JOIN user ON payment_history.user_idx=user.idx LEFT JOIN store ON store.user_idx=user.idx LEFT JOIN payment_refund ON payment_history.refund_idx=payment_refund.idx WHERE store.name LIKE '%${keyword}%'||user.name LIKE '%${keyword}%'`
        )
        .then((result) => result[0][0].total);
      const paymentList = await db
        .execute(
          `SELECT payment_history.idx AS paymentIdx, store.type AS storeType, store.name AS storeName, user.name AS userName, payment_history.paid_time, payment_history.amount AS paymentAmount, payment_refund.amount AS refundAmount, payment_refund.memo AS refundMemo, (SELECT COUNT(idx) FROM talk_log where user.idx=talk_log.user_idx group by user_idx ) AS talkCount FROM payment_history LEFT JOIN user ON payment_history.user_idx=user.idx LEFT JOIN store ON store.user_idx=user.idx LEFT JOIN payment_refund ON payment_history.refund_idx=payment_refund.idx WHERE store.name LIKE '%${keyword}%'||user.name LIKE '%${keyword}%' ORDER BY payment_history.idx DESC LIMIT ${amount} OFFSET ${
            amount * (page - 1)
          }`
        )
        .then((result) => result[0]);

      const sumData = await db
        .execute(
          `SELECT (SELECT COUNT(talk_log.idx) FROM payment_history LEFT JOIN user ON payment_history.user_idx=user.idx LEFT JOIN store ON store.user_idx=user.idx LEFT JOIN talk_log ON talk_log.user_idx=user.idx WHERE store.name LIKE '%${keyword}%'||user.name LIKE '%${keyword}%') AS totalTalk, sum(payment_history.amount) as totalAmount, sum(payment_refund.amount) as totalRefund FROM payment_history LEFT JOIN user ON payment_history.user_idx=user.idx LEFT JOIN store ON store.user_idx=user.idx LEFT JOIN payment_refund ON payment_history.refund_idx=payment_refund.idx WHERE store.name LIKE '%${keyword}%'||user.name LIKE '%${keyword}%'`
        )
        .then((result) => result[0][0]);
      res.status(200).json({ totalData, paymentList, total, sumData });
    }
  } else {
    if (keyword) {
      const total = await db
        .execute(
          `SELECT COUNT(payment_history.idx) AS total FROM payment_history LEFT JOIN user ON payment_history.user_idx=user.idx LEFT JOIN store ON store.user_idx=user.idx LEFT JOIN payment_refund ON payment_history.refund_idx=payment_refund.idx WHERE store.name LIKE ('%${keyword}%'||user.name LIKE '%${keyword}%') && payment_history.paid_time BETWEEN '${dayjs(
            start_date
          ).format('YYYY-MM-DD')}' AND '${dayjs(end_date).add(1, 'day').format('YYYY-MM-DD')}'`
        )
        .then((result) => result[0][0].total);
      const paymentList = await db
        .execute(
          `SELECT payment_history.idx AS paymentIdx, store.type AS storeType, store.name AS storeName, user.name AS userName, payment_history.paid_time, payment_history.amount AS paymentAmount, payment_refund.amount AS refundAmount, payment_refund.memo AS refundMemo, (SELECT COUNT(idx) FROM talk_log where user.idx=talk_log.user_idx group by user_idx ) AS talkCount FROM payment_history LEFT JOIN user ON payment_history.user_idx=user.idx LEFT JOIN store ON store.user_idx=user.idx LEFT JOIN payment_refund ON payment_history.refund_idx=payment_refund.idx WHERE (store.name LIKE '%${keyword}%'|| user.name LIKE '%${keyword}%') && payment_history.paid_time BETWEEN '${dayjs(
            start_date
          ).format('YYYY-MM-DD')}' AND '${dayjs(end_date)
            .add(1, 'day')
            .format('YYYY-MM-DD')}' ORDER BY payment_history.idx DESC LIMIT ${amount} OFFSET ${amount * (page - 1)}`
        )
        .then((result) => result[0]);
      const sumData = await db
        .execute(
          `SELECT (SELECT COUNT(talk_log.idx) FROM payment_history LEFT JOIN user ON payment_history.user_idx=user.idx LEFT JOIN store ON store.user_idx=user.idx LEFT JOIN talk_log ON talk_log.user_idx=user.idx WHERE (store.name LIKE '%${keyword}%'||user.name LIKE '%${keyword}%') && payment_history.paid_time BETWEEN '${start_date}' AND '${dayjs(
            end_date
          )
            .add(1, 'day')
            .format(
              'YYYY-MM-DD'
            )}' ) AS totalTalk, sum(payment_history.amount) as totalAmount, sum(payment_refund.amount) as totalRefund FROM payment_history LEFT JOIN user ON payment_history.user_idx=user.idx LEFT JOIN store ON store.user_idx=user.idx LEFT JOIN payment_refund ON payment_history.refund_idx=payment_refund.idx WHERE (store.name LIKE '%${keyword}%'||user.name LIKE '%${keyword}%') && payment_history.paid_time BETWEEN '${start_date}' AND '${dayjs(
            end_date
          )
            .add(1, 'day')
            .format('YYYY-MM-DD')}'`
        )
        .then((result) => result[0][0]);
      res.status(200).json({ totalData, paymentList, total, sumData });
    } else {
      const total = await db
        .execute(
          `SELECT COUNT(payment_history.idx) AS total FROM payment_history LEFT JOIN user ON payment_history.user_idx=user.idx LEFT JOIN store ON store.user_idx=user.idx LEFT JOIN payment_refund ON payment_history.refund_idx=payment_refund.idx WHERE payment_history.paid_time BETWEEN '${start_date}' AND '${dayjs(
            end_date
          )
            .add(1, 'day')
            .format('YYYY-MM-DD')}'`
        )
        .then((result) => result[0][0].total);
      const paymentList = await db
        .execute(
          `SELECT payment_history.idx AS paymentIdx, store.type AS storeType, store.name AS storeName, user.name AS userName, payment_history.paid_time, payment_history.amount AS paymentAmount, payment_refund.amount AS refundAmount, payment_refund.memo AS refundMemo, (SELECT COUNT(idx) FROM talk_log where user.idx=talk_log.user_idx group by user_idx ) AS talkCount FROM payment_history LEFT JOIN user ON payment_history.user_idx=user.idx LEFT JOIN store ON store.user_idx=user.idx LEFT JOIN payment_refund ON payment_history.refund_idx=payment_refund.idx WHERE payment_history.paid_time BETWEEN '${start_date}' AND '${dayjs(
            end_date
          )
            .add(1, 'day')
            .format('YYYY-MM-DD')}' ORDER BY payment_history.idx DESC LIMIT ${amount} OFFSET ${amount * (page - 1)}`
        )
        .then((result) => result[0]);
      const sumData = await db
        .execute(
          `SELECT (SELECT COUNT(talk_log.idx) FROM payment_history LEFT JOIN user ON payment_history.user_idx=user.idx LEFT JOIN store ON store.user_idx=user.idx LEFT JOIN talk_log ON talk_log.user_idx=user.idx WHERE payment_history.paid_time BETWEEN '${start_date}' AND '${dayjs(
            end_date
          )
            .add(1, 'day')
            .format(
              'YYYY-MM-DD'
            )}') AS totalTalk, sum(payment_history.amount) as totalAmount, sum(payment_refund.amount) as totalRefund FROM payment_history LEFT JOIN user ON payment_history.user_idx=user.idx LEFT JOIN store ON store.user_idx=user.idx LEFT JOIN payment_refund ON payment_history.refund_idx=payment_refund.idx WHERE payment_history.paid_time BETWEEN '${start_date}' AND '${dayjs(
            end_date
          )
            .add(1, 'day')
            .format('YYYY-MM-DD')}'`
        )
        .then((result) => result[0][0]);
      res.status(200).json({ totalData, paymentList, total, sumData });
    }
  }
});

// [엑셀 다운로드용] 결제 내역
router.get('/payment-excel', isAuth, async (req, res) => {
  const { start_date, end_date, keyword } = req.query;
  if (!(start_date && end_date)) {
    if (!keyword) {
      const paymentList = await db
        .execute(
          `SELECT payment_history.idx AS paymentIdx, store.type AS storeType, store.name AS storeName, user.name AS userName, payment_history.paid_time, payment_history.amount AS paymentAmount, payment_refund.amount AS refundAmount, payment_refund.memo AS refundMemo, (SELECT COUNT(idx) FROM talk_log where user.idx=talk_log.user_idx group by user_idx ) AS talkCount FROM payment_history LEFT JOIN user ON payment_history.user_idx=user.idx LEFT JOIN store ON store.user_idx=user.idx LEFT JOIN payment_refund ON payment_history.refund_idx=payment_refund.idx ORDER BY payment_history.idx DESC`
        )
        .then((result) => result[0]);
      res.status(200).json(paymentList);
    } else {
      const paymentList = await db
        .execute(
          `SELECT payment_history.idx AS paymentIdx, store.type AS storeType, store.name AS storeName, user.name AS userName, payment_history.paid_time, payment_history.amount AS paymentAmount, payment_refund.amount AS refundAmount, payment_refund.memo AS refundMemo, (SELECT COUNT(idx) FROM talk_log where user.idx=talk_log.user_idx group by user_idx ) AS talkCount FROM payment_history LEFT JOIN user ON payment_history.user_idx=user.idx LEFT JOIN store ON store.user_idx=user.idx LEFT JOIN payment_refund ON payment_history.refund_idx=payment_refund.idx WHERE store.name LIKE '%${keyword}%'||user.name LIKE '%${keyword}%' ORDER BY payment_history.idx DESC`
        )
        .then((result) => result[0]);
      res.status(200).json(paymentList);
    }
  } else {
    if (keyword) {
      const paymentList = await db
        .execute(
          `SELECT payment_history.idx AS paymentIdx, store.type AS storeType, store.name AS storeName, user.name AS userName, payment_history.paid_time, payment_history.amount AS paymentAmount, payment_refund.amount AS refundAmount, payment_refund.memo AS refundMemo, (SELECT COUNT(idx) FROM talk_log where user.idx=talk_log.user_idx group by user_idx ) AS talkCount FROM payment_history LEFT JOIN user ON payment_history.user_idx=user.idx LEFT JOIN store ON store.user_idx=user.idx LEFT JOIN payment_refund ON payment_history.refund_idx=payment_refund.idx WHERE (store.name LIKE '%${keyword}%'|| user.name LIKE '%${keyword}%') && payment_history.paid_time BETWEEN '${dayjs(
            start_date
          ).format('YYYY-MM-DD')}' AND '${dayjs(end_date).add(1, 'day').format('YYYY-MM-DD')}' ORDER BY payment_history.idx DESC`
        )
        .then((result) => result[0]);
      res.status(200).json(paymentList);
    } else {
      const paymentList = await db
        .execute(
          `SELECT payment_history.idx AS paymentIdx, store.type AS storeType, store.name AS storeName, user.name AS userName, payment_history.paid_time, payment_history.amount AS paymentAmount, payment_refund.amount AS refundAmount, payment_refund.memo AS refundMemo, (SELECT COUNT(idx) FROM talk_log where user.idx=talk_log.user_idx group by user_idx ) AS talkCount FROM payment_history LEFT JOIN user ON payment_history.user_idx=user.idx LEFT JOIN store ON store.user_idx=user.idx LEFT JOIN payment_refund ON payment_history.refund_idx=payment_refund.idx WHERE payment_history.paid_time BETWEEN '${start_date}' AND '${dayjs(
            end_date
          )
            .add(1, 'day')
            .format('YYYY-MM-DD')}' ORDER BY payment_history.idx DESC`
        )
        .then((result) => result[0]);
      res.status(200).json(paymentList);
    }
  }
});

// 취소/환불 처리 (+수정)
router.put(
  '/payment',
  isAuth,
  [
    body('payment_idx').trim().notEmpty().withMessage('payment_idx를 입력해 주세요.'),
    body('amount').trim().notEmpty().withMessage('금액을 입력해 주세요.'),
    validate,
  ],
  async (req, res) => {
    const { payment_idx, amount, memo } = req.body;
    const today = dayjs().format('YYYY-MM-DD HH:mm:ss');
    const foundRefund = await db.execute(`SELECT * FROM payment_history WHERE idx=${payment_idx}&&refund_idx IS NOT NULL`).then((result) => {
      console.log('result', result[0]);
      return result[0].length > 0 ? result[0][0].refund_idx : null;
    });
    console.log('foundrefund', foundRefund);
    if (foundRefund) {
      await db.execute('UPDATE payment_refund SET amount=?, memo=? WHERE idx=?', [amount, memo, foundRefund]);
      res.sendStatus(201);
    } else {
      const result = await db.execute('INSERT INTO payment_refund ( amount, memo, refund_time ) VALUES (?,?,?)', [amount, memo, today]);
      const insertId = result[0].insertId;
      const userIdx = await db.execute(`SELECT user_idx FROM payment_history WHERE idx=${payment_idx}`).then((result) => result[0][0].user_idx);
      await db.execute(`UPDATE payment_history SET refund_idx=${insertId} WHERE idx=${payment_idx}`);
      await db.execute(`UPDATE user SET grade=0 WHERE idx=${userIdx}`);
      await db.execute(`UPDATE talk_dday SET deleted_time='${today}' WHERE user_idx=${userIdx}&&dday!=3`);
      res.sendStatus(201);
    }
  }
);

// 광고 배너 수정
router.post('/banner', isAuth, upload.fields([{ name: 'image1' }, { name: 'image2' }]), async (req, res) => {
  const { type, idxs } = req.body;
  for (const idx of idxs) {
    const location = `${type}${idx}`;
    const link = req.body[`link${idx}`];
    const image = req.files[`image${idx}`] ? req.files[`image${idx}`][0] : req.body[`image${idx}`];
    const show = req.body[`show${idx}`];
    console.log('데이터 ::: ', location, link, image.filename, show);
    const find = await db.execute(`SELECT idx FROM advertising WHERE location='${location}'`).then((result) => result[0][0]);
    if (find) {
      if (typeof image === 'string') {
        await db.execute(`UPDATE advertising SET link='${link}', visible=${show} WHERE idx=${find.idx}`);
      } else {
        await db.execute(`UPDATE advertising SET image='${image.filename}', link='${link}', visible=${show} WHERE idx=${find.idx}`);
      }
    } else {
      await db.execute('INSERT INTO advertising (location, image, link, visible ) VALUES (?,?,?,?)', [location, image.filename, link, show]);
    }
  }
  res.sendStatus(204);
});

// 광고 배너 데이터
router.get('/banner', isAuth, async (req, res) => {
  const types = ['locker', 'customer', 'setting'];
  let data = {};
  for (const type of types) {
    const banners = await db.execute(`SELECT * FROM advertising WHERE location like'${type}%'`).then((result) => result[0]);
    console.log('banners', banners);
    if (banners.length > 0) {
      for (const banner of banners) {
        const idx = banner.location.split(type)[1];
        console.log(idx);
        const bannerList = {
          [idx]: {
            link: banner.link,
            image: `${URI ? URI : 'http://localhost:4000'}/uploads/${banner.image}`,
            show: banner.visible,
          },
        };
        data = { ...data, [type]: { ...data[type], ...bannerList } };
      }
    }
  }
  res.status(200).json(data);
});

// 회원 정보로 메모 불러오기 (라커 이용자 추가 시 사용)
router.post(
  '/customer-memo',
  isAuth,
  [
    body('user_idx').trim().notEmpty().withMessage('user_idx를 입력해 주세요.'),
    body('name').trim().notEmpty().withMessage('name을 입력해 주세요.'),
    body('phone').trim().notEmpty().withMessage('phone을 입력해 주세요.'),
    validate,
  ],
  async (req, res) => {
    const { user_idx, name, phone } = req.body;
    const user = await db
      .execute(`SELECT memo FROM customer WHERE user_idx=${user_idx}&&name='${name}'&&phone='${phone}'&&deleted_time IS NULL`)
      .then((result) => result[0][0]);
    console.log(name, phone, user_idx, user);
    if (user) {
      res.status(200).json(user.memo);
    } else {
      res.sendStatus(400);
    }
  }
);

export default router;
