import express from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { body } from 'express-validator';
import { db } from '../db/database.js';
import { isAuth, smsPush, upload, validate } from '../middleware/functions.js';
import { config } from '../../config.js';
import { remain3Days } from '../middleware/cron.js';

const router = express.Router();

// 이용 약관 & 개인정보 처리방침 링크 받아오기
router.get('/terms', async (req, res) => {
  const link = await db.execute('SELECT * FROM setting').then((result) => result[0]);
  res.status(200).json(link);
});

// 인증번호 발송 - 회원가입
router.post('/auth-send', [body('phone_number').trim().notEmpty().withMessage('핸드폰 번호를 입력해 주세요.'), validate], async (req, res) => {
  const { phone_number } = req.body;
  function generateRandomCode(n) {
    let str = '';
    for (let i = 0; i < n; i++) {
      str += Math.floor(Math.random() * 10);
    }
    return str;
  }
  const auth_number = generateRandomCode(4);
  const hasNumber = await db.execute(`SELECT idx FROM phone_auth WHERE phone_number='${phone_number}'`).then((result) => result[0][0]);
  const isMember = await db.execute(`SELECT idx FROM user WHERE phone='${phone_number}'&&deleted_time IS NULL`).then((result) => result[0][0]);
  if (isMember) {
    return res.status(409).json({ message: '이미 가입된 번호입니다.' });
  }
  if (hasNumber) {
    await db.execute('UPDATE phone_auth SET auth_number=? WHERE phone_number=?', [auth_number, phone_number]);
    smsPush(phone_number, auth_number);
    res.status(201).json({ auth_number: auth_number });
  } else {
    await db.execute('INSERT INTO phone_auth (phone_number, auth_number) VALUES (?,?)', [phone_number, auth_number]);
    smsPush(phone_number, auth_number);
    res.status(201).json({ auth_number: auth_number });
  }
});

// 인증번호 발송 - 비밀번호 재설정
router.post('/auth-send-pw', [body('phone_number').trim().notEmpty().withMessage('핸드폰 번호를 입력해 주세요.'), validate], async (req, res) => {
  const { phone_number } = req.body;
  function generateRandomCode(n) {
    let str = '';
    for (let i = 0; i < n; i++) {
      str += Math.floor(Math.random() * 10);
    }
    return str;
  }
  const auth_number = generateRandomCode(4);
  const hasNumber = await db.execute(`SELECT idx FROM phone_auth WHERE phone_number='${phone_number}'`).then((result) => result[0][0]);
  const isMember = await db.execute(`SELECT idx FROM user WHERE phone='${phone_number}'&&deleted_time IS NULL`).then((result) => result[0][0]);
  if (!isMember) {
    return res.status(401).json({ message: '회원이 아닙니다.' });
  }
  if (hasNumber) {
    await db.execute('UPDATE phone_auth SET auth_number=? WHERE phone_number=?', [auth_number, phone_number]);
    smsPush(phone_number, auth_number);
    res.status(201).json({ auth_number: auth_number });
  } else {
    await db.execute('INSERT INTO phone_auth (phone_number, auth_number) VALUES (?,?)', [phone_number, auth_number]);
    smsPush(phone_number, auth_number);
    res.status(201).json({ auth_number: auth_number });
  }
});

// 인증번호 확인
router.post(
  '/auth',
  [
    body('phone_number').trim().notEmpty().withMessage('핸드폰 번호를 입력해 주세요.'),
    body('auth_number').trim().notEmpty().withMessage('인증 번호를 입력해 주세요.'),
    validate,
  ],
  async (req, res) => {
    const { phone_number, auth_number } = req.body;
    const auth = await db.execute(`SELECT auth_number FROM phone_auth WHERE phone_number='${phone_number}'`).then((result) => result[0][0]);
    const user_idx = await db.execute(`SELECT idx FROM user WHERE phone='${phone_number}'&&deleted_time IS NULL`).then((result) => result[0][0]);
    const userIdx = user_idx && user_idx.idx ? user_idx : '';
    console.log('유저 번호', user_idx);
    console.log('auth', auth);
    if (auth) {
      if (parseInt(auth.auth_number) !== parseInt(auth_number)) {
        res.status(400).json({ message: '인증 실패' });
      } else {
        res.status(200).json({ message: '인증 성공', user_idx: userIdx });
      }
    } else {
      res.status(400).json({ message: '인증 실패' });
    }
  }
);

// 이메일 중복 체크
router.post('/email-check', [body('email').trim().notEmpty().withMessage('이메일을 입력해 주세요.'), validate], async (req, res) => {
  const { email } = req.body;
  const foundEmail = await db.execute('SELECT deleted_time FROM user WHERE email=?', [email]).then((result) => result[0][0]);
  if (foundEmail) {
    if (!foundEmail.deleted_time) {
      return res.status(409).json({ message: `${email}는 이미 존재하는 이메일입니다.` });
    }
  } else {
    return res.status(200).json({ message: `${email}는 사용 가능한 이메일입니다.` });
  }
});

// 닉네임 중복 체크
router.post('/nickname-check', [body('nickname').trim().notEmpty().withMessage('닉네임을 입력해 주세요.'), validate], async (req, res) => {
  const { nickname } = req.body;
  const foundNickname = await db.execute('SELECT deleted_time FROM user WHERE nickname=?', [nickname]).then((result) => result[0][0]);
  if (foundNickname) {
    if (!foundNickname.deleted_time) {
      return res.status(409).json({ message: `${nickname}는 이미 존재하는 닉네임입니다.` });
    }
  } else {
    return res.status(200).json({ message: `${nickname}는 사용 가능한 닉네임입니다.` });
  }
});

// 회원가입
router.post(
  '/account',
  upload.single('image'),
  [
    body('email').trim().notEmpty().withMessage('이메일을 입력해 주세요.'),
    body('password').trim().notEmpty().withMessage('비밀번호를 입력해 주세요.'),
    body('name').trim().notEmpty().withMessage('이름을 입력해 주세요.'),
    body('nickname').trim().notEmpty().withMessage('닉네임을 입력해 주세요.'),
    body('phone').trim().notEmpty().withMessage('핸드폰 번호를 입력해 주세요.'),
    body('agree_marketing').trim().notEmpty().withMessage('마케팅 정보 수신 여부를 입력해 주세요.'),
    body('type').trim().notEmpty().withMessage('시설 유형을 입력해 주세요.'),
    body('store_name').trim().notEmpty().withMessage('시설 이름을 입력해 주세요.'),
    body('zip_code').trim().notEmpty().withMessage('우편 번호를 입력해 주세요.'),
    body('address1').trim().notEmpty().withMessage('주소를 입력해 주세요.'),
    body('address2').trim().notEmpty().withMessage('상세 주소를 입력해 주세요.'),
    body('contact').trim().notEmpty().withMessage('시설 연락처를 입력해 주세요.'),
    validate,
  ],
  async (req, res) => {
    const { email, password, name, nickname, phone, agree_marketing, type, store_name, zip_code, address1, address2, contact } = req.body;
    const image = req.file;

    const foundNickname = await db.execute('SELECT deleted_time FROM user WHERE nickname=?', [nickname]).then((result) => result[0][0]);
    if (foundNickname) {
      console.log('닉네임', foundNickname);
      if (!foundNickname.deleted_time) {
        return res.status(409).json({ message: `${nickname}는 이미 존재하는 닉네임입니다.` });
      }
    }
    const hashedPassword = await bcrypt.hash(password, config.bcrypt.saltRounds);
    const result = await db.execute(
      'INSERT INTO user (email, password, name, nickname, phone, image, created_time, agree_marketing) VALUES (?,?,?,?,?,?,?,?)',
      [email, hashedPassword, name, nickname, phone, image ? image.filename : null, new Date(), agree_marketing]
    );
    const user_idx = result[0].insertId;
    await db.execute('INSERT INTO store (user_idx, type, name, zip_code, address1, address2, contact, created_time) VALUES (?,?,?,?,?,?,?,?)', [
      user_idx,
      type,
      store_name,
      zip_code,
      address1,
      address2,
      contact,
      new Date(),
    ]);
    res.sendStatus(201);
  }
);

// 로그인
router.post(
  '/sign-in',
  [
    body('email').trim().notEmpty().withMessage('이메일을 입력해 주세요.'),
    body('password').trim().notEmpty().withMessage('비밀번호를 입력해 주세요.'),
    validate,
  ],
  async (req, res) => {
    const { email, password } = req.body;
    const found = await db.execute('SELECT * FROM user WHERE email=?', [email]).then((result) => result[0][0]);
    if (found) {
      if (found.deleted_time) {
        return res.status(401).json({ message: `아이디 또는 비밀번호를 확인해 주세요.` });
      }
      const checkPassword = await bcrypt.compare(password, found.password);
      if (!checkPassword) {
        return res.status(401).json({ message: `아이디 또는 비밀번호를 확인해 주세요.` });
      }
      await db.execute('UPDATE user SET login_time=? WHERE email=?', [new Date(), email]);
      const token = jwt.sign({ idx: found.idx }, config.jwt.secretKey);
      res.status(200).json({ token: token, userInfo: found });
    } else {
      return res.status(401).json({ message: `아이디 또는 비밀번호를 확인해 주세요.` });
    }
  }
);

// 개인 정보 & 시설 정보 불러오기
router.get('/info', isAuth, async (req, res) => {
  const data = await db
    .execute(
      'SELECT user.name AS user_name, user.nickname, store.idx AS store_idx, store.type, store.name AS store_name, store.zip_code, store.address1, store.address2, store.contact FROM user JOIN store ON user.idx=store.user_idx WHERE user.idx=?',
      [req.authorizedUser]
    )
    .then((result) => result[0][0]);
  res.status(200).json(data);
});

// 닉네임 중복 체크 - 개인 정보 수정 시 사용
router.post(
  '/nickname-check-edit',
  isAuth,
  [body('nickname').trim().notEmpty().withMessage('닉네임을 입력해 주세요.'), validate],
  async (req, res) => {
    const { nickname } = req.body;
    const foundNickname = await db.execute('SELECT * FROM user WHERE nickname=?&&deleted_time IS NULL', [nickname]).then((result) => result[0][0]);
    if (foundNickname) {
      const myNickname = await db.execute('SELECT nickname FROM user WHERE idx=?', [req.authorizedUser]).then((result) => result[0][0].nickname);
      if (myNickname !== nickname) {
        res.status(409).json({ message: `${nickname}는 이미 존재하는 닉네임입니다.` });
      } else {
        return res.status(200).json({ message: `${nickname}는 사용 가능한 닉네임입니다.` });
      }
    } else {
      return res.status(200).json({ message: `${nickname}는 사용 가능한 닉네임입니다.` });
    }
  }
);

// 개인 정보 수정
router.put(
  '/user-info',
  isAuth,
  [
    body('name').trim().notEmpty().withMessage('이름을 입력해 주세요.'),
    body('nickname').trim().notEmpty().withMessage('닉네임을 입력해 주세요.'),
    validate,
  ],
  async (req, res) => {
    const { name, nickname } = req.body;
    console.log(req.body);
    const phone = req.body.phone ?? '';
    if (phone === '') {
      await db.execute('UPDATE user SET name=?, nickname=? WHERE idx=?', [name, nickname, req.authorizedUser]);
      res.status(200).json({ message: '개인 정보가 변경되었습니다.' });
    } else {
      await db.execute('UPDATE user SET name=?, nickname=?, phone=? WHERE idx=?', [name, nickname, phone, req.authorizedUser]);
      res.status(200).json({ message: '개인 정보가 변경되었습니다.' });
    }
  }
);

// 시설 정보 수정
router.put(
  '/store-info',
  isAuth,
  [
    body('store_idx').trim().notEmpty().withMessage('시설 idx를 입력해 주세요.'),
    body('type').trim().notEmpty().withMessage('시설 유형을 입력해 주세요.'),
    body('name').trim().notEmpty().withMessage('시설 이름을 입력해 주세요.'),
    body('zip_code').trim().notEmpty().withMessage('우편 번호를 입력해 주세요.'),
    body('address1').trim().notEmpty().withMessage('주소를 입력해 주세요.'),
    body('address2').trim().notEmpty().withMessage('상세 주소를 입력해 주세요.'),
    body('contact').trim().notEmpty().withMessage('시설 연락처를 입력해 주세요.'),
    validate,
  ],
  async (req, res) => {
    const { store_idx, type, name, zip_code, address1, address2, contact } = req.body;
    await db.execute('UPDATE store SET type=?, name=?, zip_code=?, address1=?, address2=?, contact=? WHERE idx=?', [
      type,
      name,
      zip_code,
      address1,
      address2,
      contact,
      store_idx,
    ]);
    res.status(200).json({ message: '시설 정보가 변경되었습니다.' });
  }
);

// 비밀번호 찾기 후 변경
router.put(
  '/password',
  [
    body('idx').trim().notEmpty().withMessage('유저 idx를 입력해 주세요.'),
    body('new_password').trim().notEmpty().withMessage('새로운 비밀번호를 입력해 주세요.'),
    validate,
  ],
  async (req, res) => {
    const { idx, new_password } = req.body;
    const hashedPassword = await bcrypt.hash(new_password, config.bcrypt.saltRounds);
    await db.execute('UPDATE user SET password=? WHERE idx=?', [hashedPassword, idx]);
    res.status(200).json({ message: '비밀번호가 변경되었습니다.' });
  }
);

// 비밀번호 확인(내정보에서 비밀번호 변경 시 사용)
router.post(
  '/my-password-auth',
  isAuth,
  [body('password').trim().notEmpty().withMessage('비밀번호를 입력해 주세요.'), validate],
  async (req, res) => {
    const { password } = req.body;
    console.log(password, req.authorizedUser);
    const found = await db.execute('SELECT password FROM user WHERE idx=?', [req.authorizedUser]).then((result) => result[0][0].password);
    if (found) {
      const checkPassword = await bcrypt.compare(password, found);
      if (!checkPassword) {
        res.status(401).json({ message: `비밀번호를 확인해 주세요.` });
      } else {
        res.status(200).json({ message: '비밀번호 인증 성공' });
      }
    } else {
      return res.status(401).json({ message: `비밀번호를 확인해 주세요.` });
    }
  }
);

// 비밀번호 변경(내정보에서)
router.put(
  '/my-password',
  isAuth,
  [body('new_password').trim().notEmpty().withMessage('새로운 비밀번호를 입력해 주세요.'), validate],
  async (req, res) => {
    const { new_password } = req.body;
    const found = await db.execute('SELECT password FROM user WHERE idx=?', [req.authorizedUser]).then((result) => result[0][0]);
    if (found) {
      const checkPassword = await bcrypt.compare(new_password, found.password);
      if (checkPassword) {
        return res.status(409).json({ message: `기존 비밀번호와 같음` });
      }
    }
    const hashedPassword = await bcrypt.hash(new_password, config.bcrypt.saltRounds);
    await db.execute('UPDATE user SET password=? WHERE idx=?', [hashedPassword, req.authorizedUser]);
    res.status(200).json({ message: '비밀번호가 변경되었습니다.' });
  }
);

// 지공사 등록
router.post('/driller', isAuth, [body('name').trim().notEmpty().withMessage('이름을 입력해 주세요.'), validate], async (req, res) => {
  const { name } = req.body;
  const foundName = await db
    .execute(`SELECT idx FROM driller WHERE name='${name}'&&user_idx=${req.authorizedUser}&&deleted_time IS NULL`)
    .then((result) => result[0][0]);
  if (foundName) {
    res.status(409).json({ message: `같은 이름을 가진 지공사가 존재합니다.` });
  } else {
    await db.execute('INSERT INTO driller ( user_idx, name ) VALUES (?,?)', [req.authorizedUser, name]);
    res.sendStatus(201);
  }
});

// 지공사 목록
router.get('/driller', isAuth, async (req, res) => {
  const { driller, user_idx } = req.query;
  console.log('드릴러:', req.query);
  if (driller) {
    const list = await db
      .execute(`SELECT * FROM driller WHERE user_idx=${user_idx ? user_idx : req.authorizedUser}&&deleted_time IS NULL || idx = ${driller}`)
      .then((result) => result[0]);
    res.status(200).json(list);
  } else {
    const list = await db
      .execute(`SELECT * FROM driller WHERE user_idx=${user_idx ? user_idx : req.authorizedUser}&&deleted_time IS NULL`)
      .then((result) => result[0]);
    res.status(200).json(list);
  }
});

// 지공사 삭제
router.post(
  '/driller-delete',
  isAuth,
  [body('driller_idx').trim().notEmpty().withMessage('지공사 idx를 입력해 주세요.'), validate],
  async (req, res) => {
    const { driller_idx } = req.body;
    await db.execute('UPDATE driller SET deleted_time=? WHERE idx=?', [new Date(), driller_idx]);
    res.sendStatus(204);
  }
);

// 유저 grade, dday 받기
router.get('/grade', isAuth, async (req, res) => {
  const grade = await db.execute(`SELECT grade FROM user WHERE idx=${req.authorizedUser}`).then((result) => result[0][0].grade);
  const dday = await db
    .execute(
      `SELECT group_concat(DISTINCT talk_dday.dday) as dday FROM user LEFT JOIN talk_dday ON user.idx=talk_dday.user_idx WHERE talk_dday.deleted_time IS NULL&&user.idx=${req.authorizedUser} GROUP BY talk_dday.user_idx`
    )
    .then((result) => result[0][0]);
  res.status(200).json({ grade, dday });
});

// 회원 등급(무료, 유료 회원) 변경
router.put('/grade', isAuth, [body('type').trim().notEmpty().withMessage('타입을 입력해 주세요.'), validate], async (req, res) => {
  const { type } = req.body;
  if (type === 'to-paid') {
    await db.execute(`UPDATE user SET grade=1 WHERE idx=${req.authorizedUser}`);
    await db.execute(`UPDATE talk_dday SET deleted_time=NULL WHERE user_idx=${req.authorizedUser}&&dday!=3`);
    res.status(200).json({ message: '유료 회원으로 변경됨.' });
  } else if (type === 'to-free') {
    await db.execute(`UPDATE user SET grade=0 WHERE idx=${req.authorizedUser}`);
    await db.execute('UPDATE talk_dday SET deleted_time=? WHERE user_idx=?&&dday!=3', [new Date(), req.authorizedUser]);
    res.status(200).json({ message: '무료 회원으로 변경됨.' });
  }
});

export default router;
