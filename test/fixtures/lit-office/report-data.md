---
title: 도서관 이용 보고서
author: 운영팀
notice: 예시 데이터 — 실제 수치로 바꿔 주세요
data: data/numbers.json
---

# 요약

올해 방문은 {{ visits }}명으로 전년보다 {{ visit_growth | +.1f }}% 늘었고, 대출률은 {{ loan_rate | .1f }}%다.

# 분관별 이용

{{ table:branches }}
