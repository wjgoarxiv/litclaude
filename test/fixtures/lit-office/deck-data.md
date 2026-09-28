---
template: AZURE-PRO
title: 도서관 이용 현황 (예시)
notice: 예시 데이터 — 실제 수치로 바꿔 주세요
data: data/numbers.json
---

---
layout: cover

# 도서관 이용 현황
---

---
layout: content

## 방문 {{ visits }}명, 전년보다 {{ visit_growth | +.1f }}%

| 방문 | 대출 | 대출률 |
|---|---|---|
| {{ visits }}명 | {{ loans }}권 | {{ loan_rate | .1f }}% |
---

---
layout: content

## 분관별 이용

{{ table:branches }}

> 분관별 방문과 대출 (예시)
---
