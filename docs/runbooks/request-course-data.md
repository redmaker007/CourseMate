# Runbook：申请课程数据授权

> 整理日期：2026-09-08
>
> 为什么走申请而不是逆向公开接口，见 [ADR-0002](../adr/0002-do-not-reverse-engineer-university-course-search.md)。
> 拿到数据之后怎么录入，见 [seed-courses.md](./seed-courses.md)。

包含两所学校的申请渠道、邮件草稿，以及对方一定会问的信息清单。

---

## ⚠️ 发信前必须先决定的一件事

两校的申请表都会问**用途性质**，而 UMich 的条款写得很死：

> Access to the API Directory may be used only for **academic, educational, U-M administrative, or research purposes** and cannot be transferred to or shared with anyone else.

CourseMate 如果被定位成"学生课外项目 / 教育用途"，大概率符合；如果被定位成**创业项目、有商业化计划、或将来要卖广告**，那就**不符合**，用这个渠道拿数据反而是违规的。

**这个问题必须在发信前想清楚，并且在信里如实说。** 事后被发现用途与申报不符，比一开始就被拒严重得多。

如果确实有商业化打算，UMich 这条路可能走不通，需要问他们有没有非学术用途的授权方式——我在邮件草稿里留了这句话。

---

## 一、UW–Madison

### 渠道

| | |
|---|---|
| 申请入口 | <http://crisauthorization.wisc.edu/> |
| 邮件联系 | `road@doit.wisc.edu`（DoIT RO Apps Development Team） |
| 服务名称 | CAOS — Curricular and Academic Web Services |
| 官方说明 | <https://kb.wisc.edu/registrar/11753> |

CAOS 的定位是把课程数据提供给 "authorized recipient systems"，所以走的是授权制，不是公开接口。

### 邮件草稿

**Subject:** Request for course catalog data access — student project (CourseMate)

```
Hello,

I'm a student building CourseMate, a tool that helps students in large
lecture courses find and connect with classmates taking the same course.
Accounts are restricted to verified school email addresses, and each
school's data is isolated from every other school's.

I'd like to request access to course catalog data through CAOS
(Curricular and Academic Web Services), rather than scraping the public
Course Search & Enroll interface.

What I need:
  - Subject code, course number, and course title
  - Term identifier
  - Optionally: section number and section type (LEC / DIS / LAB)
  - Nothing about enrollment counts, seat availability, waitlists,
    or any individual student

How I'd use it:
  - A one-time bulk import, refreshed roughly once per term
  - Stored as reference data so students pick their courses from an
    autocomplete list instead of typing course names by hand
  - Displayed only to signed-in students of that same school

Volume and frequency:
  - One bulk fetch per term. Not continuous polling, and no real-time
    queries against your systems from our application.
  - Happy to work within any rate limit, caching requirement, or
    refresh window you specify.

I'm glad to sign a data use agreement, attribute the source, or narrow
the scope. If CAOS isn't the right channel for this request, I'd
appreciate a pointer to the correct one.

Thank you,
<姓名>
<wisc.edu 或 umich.edu 邮箱>
<项目链接（可选）>
```

---

## 二、University of Michigan

### 渠道

| | |
|---|---|
| 门户 | API Directory Portal（用 uniqname + Duo 登录） |
| 说明页 | <https://its.umich.edu/data/data-database/api-directory/getting-started> |
| 服务台工单 | <https://teamdynamix.umich.edu/TDClient/30/Portal/Requests/ServiceDet?ID=83> |
| 邮件联系 | `apidir-contact@umich.edu` |

### 学生申请的三个硬性条件

1. **必须有教职工背书。** 学生要申请新的 developer organization，需要说明用途，并提供一位能确认"此访问用于学术目的"的教职工姓名。**那位老师要自己发邮件到 `apidir-contact@umich.edu`。**
2. **必须在 U-M 校园网或 VPN 内**才能访问 API Directory。
3. **凭据不得转让或共享。** Client ID / Secret 只能自己用——这意味着**不能给组员**，也不能放进代码库。

### 流程

1. 登录 API Directory Portal（uniqname + 密码 + Duo 双因素）
2. 创建一个 app
3. 订阅需要的 API product
4. 拿到 Client ID / Client Secret

### 先发给教职工的信（请对方背书）

**Subject:** Request for API Directory sponsorship — student project

```
Dear Professor <姓名>,

I'm a student working on CourseMate, a project that helps students in
large lecture courses find classmates taking the same course. Sign-up is
restricted to verified umich.edu addresses.

To populate our course catalog, I'd like to request access to the U-M
API Directory's Courses API rather than scraping the public course
search. Student requests require a faculty member to confirm that the
access is for academic or educational purposes.

If you're willing to sponsor this, the API Directory team asks that you
email your consent to apidir-contact@umich.edu.

I'd be glad to walk you through what the project does and exactly which
data fields I'd be requesting (subject, course number, title, term, and
optionally section number and type — no enrollment or student data).

Thank you for considering,
<姓名> (<uniqname>)
```

### 关于用途性质的补充问句

如果你们的定位不完全属于学术用途，在给 `apidir-contact@umich.edu` 的信里加上：

```
One clarification before I proceed: the API Directory terms state that
access is limited to academic, educational, U-M administrative, or
research purposes. This project is <如实描述：课外项目 / 非营利 /
有商业化计划>. Could you confirm whether this qualifies, and if not,
whether there's an alternative channel for this kind of use?
```

**如实写。** 与其事后被撤销授权，不如现在就问清楚。

---

## 三、对方一定会问的信息（先准备好）

发信前把这张表填好，回信时直接贴过去，能省掉两三轮来回。

| 项目 | 内容 |
|---|---|
| 项目名称 | CourseMate |
| 用途性质 | **待填** —— 学术/教育 / 非营利课外项目 / 有商业化计划 |
| 负责人 | 姓名、学校邮箱、uniqname 或 NetID |
| 团队规模 | 2 人 |
| 需要的字段 | school、term、subject、course number、course title；可选 section number、section type、instructor |
| **明确不需要的字段** | 选课人数、余位、候补名单、上课地点时间、任何学生个人信息 |
| 获取频率 | 每学期一次批量拉取；不做持续轮询 |
| 是否实时查询对方系统 | **否**。应用只读自己的数据库 |
| 数据存放 | Supabase（托管 Postgres，美国区），传输与静态均加密 |
| 谁能看到 | 仅同校已登录学生。跨校数据隔离由数据库行级安全策略强制 |
| 保留期限 | 当前学期 + 上一学期 |
| 是否二次分发 | 否。不对外提供接口、不导出、不转售 |
| 愿意接受的约束 | 限流、缓存窗口、署名来源、签署数据使用协议 |

---

## 四、如果被拒

按优先级：

1. **问清楚拒绝原因**，是用途不符、还是渠道不对、还是需要补材料。很多时候只是发错了部门。
2. **缩小范围再申请**——比如只要几个院系、只要课号和课名、不要 section。
3. **退回手动录入**。见下。
4. **不要**转而去逆向公开搜索接口。UW System Regent Policy Document 25-3 明确写着 "Technical ability to access unauthorized resources... does not by itself imply authorization to do so"，适用范围包含在读学生。而且既然已经知道存在正规渠道，绕开它在任何审查场景下都无法辩护。

---

## 五、申请期间不要停工

授权周期是几天到几周。**这件事不阻塞 MVP。**

冷启动的真正瓶颈是没有其他学生，不是没有课程记录——第一个学生搜到课，群里也还是只有他一个。所以：

- 先做**手动创建 + 课号自动补全**的降级路径，课表为空也能用
- 数据到位后灌进 `course_catalog` 参考表，自动补全立刻变好，其余代码不用改

---

## 参考链接

- [Acceptable Use of Information Technology Resources — UW Board of Regents (RPD 25-3)](https://www.wisconsin.edu/regents/policies/acceptable-use-of-information-technology-resources/)
- [CAOS — Curricular and Academic Web Services (UW-Madison KB)](https://kb.wisc.edu/registrar/11753)
- [Getting Started with the API Directory (U-M ITS)](https://its.umich.edu/data/data-database/api-directory/getting-started)
- [API Directory now available to university students (U-M)](https://michigan.it.umich.edu/news/2020/02/14/api-directory-now-available-to-university-students/)
- [ITS-API Directory Access Request (U-M TeamDynamix)](https://teamdynamix.umich.edu/TDClient/30/Portal/Requests/ServiceDet?ID=83)
