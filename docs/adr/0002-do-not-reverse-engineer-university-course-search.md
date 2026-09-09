# 不逆向学校的公开课程搜索接口

课程库数据一律通过学校的正式授权渠道获取，不去逆向 `public.enroll.wisc.edu` 这类公开课程搜索页背后的 XHR 接口，也不写绕过其访问控制的抓取脚本。UW–Madison 走 CAOS（`crisauthorization.wisc.edu`），U-M 走 ITS API Directory（需教职工背书）。

## 为什么

**站点是学校的，不是第三方的。** 这一点被误判过，可以直接验证：

```bash
nslookup -type=SOA wisc.edu
# primary name server = ipam-cssc.doit.wisc.edu
# responsible mail addr = hostmaster.doit.wisc.edu
```

`wisc.edu` 由 DoIT（UW–Madison 信息技术部）管理，连权威 DNS 都是 DoIT 的主机。`public.enroll.wisc.edu` 是它的子域，CNAME 指向 CloudFront——但那只是 CDN 托管，就像本项目托管在 Vercel 上并不使它成为 Vercel 的产品。该前端的源码也在 DoIT 自己的 GitLab（`pages.doit.wisc.edu/IEVAVOLD/course-search-enroll-fe`），页面挂的是学校的 Ping SSO。

**存在专门针对自动化的访问控制。** 浏览器访问正常，程序访问被 CloudFront 返回 403，连 `robots.txt` 都取不到。因此脚本要跑通，第一步必然是伪装成浏览器——那就从"读取公开数据"变成"绕过访问控制"。

**政策直接否定了"技术上能做到就等于可以做"。** UW System Regent Policy Document 25-3（Acceptable Use of Information Technology Resources）原文：

> Technical ability to access unauthorized resources or others' accounts does not by itself imply authorization to do so.

其适用范围明确包含 `currently enrolled students`——即本项目的两名开发者。

**正规通道存在。** CAOS 明确面向 "authorized recipient systems"。在已知存在授权渠道的情况下绕开它，在任何事后审查中都无法辩护。

## 常见的反驳，以及为什么不成立

**"课号课名是事实信息，不受版权保护。"** 这一半是对的（Feist 案）。但版权管的是能否复制**内容**，与是否获得**访问系统的授权**是两套独立规则——后者由服务条款、合同与计算机滥用相关法律管辖。

**"很多学生项目都这么干且没出事。"** 属实。此处不同之处在于四个条件同时成立：抓取对象是开发者自己就读的学校、开发者是在读学生（受学生行为准则约束）、对方有主动的自动化拦截、且存在正规申请通道。少任何一条，讨论空间都会大很多。

## 代价与取舍

授权周期为数天到数周，比写脚本慢。接受这个代价，因为：本项目的推广完全依赖校园渠道，被学校标记是最输不起的结果；而课程库并非 MVP 的瓶颈——冷启动缺的是同校同学，不是课程记录行数，第一个学生即使搜到课，群里也仍然只有他一人。

申请期间不停工：先做手动创建加课号自动补全的降级路径，课表为空也可用；数据到位后灌入参考表，其余代码不改。

## 何时应当重新审视

学校开放了无需授权的公开数据集；或申请被拒且对方说明了可接受的替代获取方式；或项目改为使用第三方合法授权的课程数据源。届时写新的 ADR 取代本篇，不要直接修改。

相关：[申请课程数据授权](../runbooks/request-course-data.md) · [录入课程](../runbooks/seed-courses.md)
