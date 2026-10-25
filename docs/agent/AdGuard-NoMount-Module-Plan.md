# AdGuard CA 전용 NoMount 모듈 — 구현 계획

> **현재 구현 결정:** 사용자 요청으로 OpenSSL 의존성을 제거했다. `0f4ed297.<숫자>` 파일명, 일반 파일·비어 있지 않음, DER/PEM 외형만 검사하며 Subject·CA 여부·서명·유효기간은 검증하지 않는다. 외형을 유지한 내용 손상이나 다른 인증서의 이름 변경은 구별하지 못한다. 아래 X.509 검증 관련 항목은 원래 목표이며, 현재 제한과 수동 검증 절차는 `module/README.md`를 따른다.

## 1. 목표

AdGuard for Android의 **AdGuard Personal CA 인증서 한 장만** Android 시스템 CA 저장소에 주입하는 초소형 KernelSU/APatch 모듈을 만든다. 주입은 별도 `mount`, `bind mount`, `nsenter`, `tmpfs` 없이 **NoMount 메타모듈의 VFS 파일 리다이렉션**에 위임한다.

**완료 조건**

- 코드와 설치·부팅·제거 과정에서 `/data/local/tmp`를 읽기·쓰기·생성·삭제하지 않는다.
- 인증서 및 로그 등 모든 모듈 관리 파일은 `/data/adb/modules/<module-id>/` 아래에 둔다.
- AdGuard **Personal CA만** 주입하고 **Intermediate CA는 사용자 저장소에 유지**한다.
- AdGuard 인증서 재발급 후 재부팅하면 새 인증서가 반영된다.
- 인증서가 없거나 검증에 실패하면 오래된 인증서를 조용히 재주입하지 않는다.
- NoMount의 실제 주입과 Android 앱의 인증서 신뢰 여부를 **별도로** 검증한다.

## 2. 범위 및 전제 조건

### 포함

- Android 14 이상에서 Conscrypt APEX의 CA 저장소에 AdGuard Personal CA 파일 1개 주입
- 부팅 단계에서 인증서 자동 검색·복사·갱신
- 최소한의 로그 및 실패 처리, 비파괴적 제거·복구
- KernelSU/APatch + NoMount 메타모듈 환경의 검증

### 제외

- 다른 사용자 CA 일괄 이동, 인증서 관리 WebUI, 실시간 인증서 변경 감시
- 시스템 파티션 직접 수정, 임의의 mount namespace 조작
- `/data/local/tmp`의 기존 내용 자동 삭제
- 루트 탐지 우회 보장, 인증서 고정(pinning) 우회 보장

### 사전 조건

1. 기기에 KernelSU 또는 APatch가 설치되어 있으며, 정상적인 **모듈 실행 및 메타모듈 기능**을 지원한다.
2. NoMount가 설치되어 있고 VFS/LKM 초기화가 정상 동작한다.
3. AdGuard에서 **Personal CA와 Intermediate CA를 모두 사용자 인증서 저장소**에 먼저 설치한다.
4. 기존 `adguardcert` 및 `MoveCertificate`처럼 동일 인증서 경로를 주입하는 모듈은 비활성화/제거한다.
5. 부팅 오류 시 모듈을 비활성화할 수 있는 복구 수단을 확보한다.

> **지원 범위 주의:** Android 14+ APEX 경로를 1차 목표로 한다. Android 13 이하는 별도 `/system/etc/security/cacerts` 구현으로 확장할 수 있지만 초기 버전에서는 지원하지 않는다. KernelSU-Next의 *late-load*와 일부 APatch 구현에서는 실행 순서가 달라질 수 있으므로 실제 기기에서 확인한다.

## 3. 최소 모듈 구조

```text
adguard-ca-nomount/
├── module.prop
├── post-fs-data.sh
└── README.md

# 설치 이후, 부팅 스크립트가 생성하는 디렉터리
/data/adb/modules/adguard-ca-nomount/
├── module.prop
├── post-fs-data.sh
├── README.md
├── logs/
│   └── boot.log                    # 선택 사항
└── apex/
    └── com.android.conscrypt/
        └── cacerts/
            └── 0f4ed297.0         # AdGuard Personal CA
```

`apex/...` 디렉터리는 **부팅 스크립트에서 생성**한다. 해당 디렉터리에 `.gitkeep` 등 일반 파일을 패키징하면 NoMount가 불필요한 파일까지 주입할 수 있으므로 넣지 않는다.

`module.prop` 예시:

```ini
id=adguard-ca-nomount
name=AdGuard CA for NoMount
version=0.1.0
versionCode=1
author=Local
description=Inject AdGuard Personal CA through NoMount without temporary mounts
```

> 모듈은 **일반 모듈**이며 `metamodule=true`를 넣지 않는다. NoMount만 메타모듈이다.

## 4. 부팅 처리 흐름

```text
AdGuard 사용자 인증서 저장소
  /data/misc/user/0/cacerts-added/0f4ed297.*
            │
            ▼
일반 모듈 post-fs-data.sh
  1) NoMount 및 디렉터리 준비 상태 확인
  2) AdGuard Personal CA 후보 탐색
  3) 후보의 파일명·인증서 식별/형식 확인
  4) 선택된 인증서를 모듈 내부 임시 파일로 복사
  5) 권한·SELinux 컨텍스트 처리 후 원자적으로 교체
            │
            ▼
/data/adb/modules/adguard-ca-nomount/
  apex/com.android.conscrypt/cacerts/0f4ed297.0
            │
            ▼
NoMount metamount.sh
  모듈의 apex/ 트리를 스캔하여 VFS 규칙 등록
            │
            ▼
/apex/com.android.conscrypt/cacerts/0f4ed297.0
  Android 앱이 시스템 CA 파일로 접근
```

**순서 근거:** 표준 KernelSU 메타모듈 실행 순서에서는 일반 모듈의 `post-fs-data.sh`가 모두 실행된 후 메타모듈의 `metamount.sh`가 실행된다. NoMount의 `metamount.sh`는 `apex`를 주입 대상 파티션으로 포함하고 일반 모듈의 파일을 스캔한다. 다만 실제 기기/루트 구현의 순서는 반드시 로그로 확인한다.

## 5. 구현 세부 요구 사항

### 5.1 인증서 식별

- 1차 탐색 위치: `/data/misc/user/0/cacerts-added/`.
- 기존 `adguardcert`와 동일한 AdGuard Personal CA subject hash `0f4ed297`을 기본값으로 사용한다.
- `0f4ed297.<숫자>` 형태만 허용하고, 숫자 suffix가 가장 큰 후보를 선택한다(상위 모듈의 기존 방식). 이 선택이 재발급 순서를 항상 보장하는 것은 아니므로 추후 검증 가능하도록 기록한다.
- 가능하면 X.509 DER 파싱으로 **Subject 및 CA 여부**를 검증한다. 초기 구현에서 안전한 파서가 기기 내에 없다면, 파일명만으로 임의 인증서를 신뢰하지 않도록 **명시적인 제한 사항과 테스트 절차**를 둔다.
- AdGuard Intermediate CA(`47ec1af8.*`)는 **복사하지 않는다**. 사용자 저장소에 남겨둔다.

### 5.2 파일 반영

- 최종 목적지: `$MODDIR/apex/com.android.conscrypt/cacerts/0f4ed297.0`.
- 같은 디렉터리에 임시 파일로 복사하고, 복사 성공·내용 일치·권한 설정을 확인한 뒤 `mv`로 교체한다.
- 권장 파일 권한은 `0644`, 소유자는 `root:root`로 시작하되 실제 Conscrypt 파일의 SELinux 레이블을 확인해 맞춘다. **SELinux 컨텍스트를 고정값으로 단정하지 않는다.**
- 부팅 때마다 소스 인증서와 목적지의 해시를 비교하여 변경된 경우에만 교체하는 최적화는 선택 사항이다.
- 소스 인증서가 없거나 유효하지 않으면 이전 목적지 파일을 제거하고 오류를 기록한다. 정상 경로에서 이전 인증서가 남아 계속 주입되지 않도록 한다.
- 주입 성공 여부는 `cp` 성공만으로 판정하지 않는다.

### 5.3 NoMount 연동

- 전용 모듈은 **일반 KernelSU/APatch 모듈**로 설치한다. 직접 `nm rule add`를 호출하지 않는 것을 기본 설계로 한다.
- NoMount가 `apex/`를 자동 스캔하여 주입하는지 확인한다.
- NoMount의 모듈 비활성화 파일(`disable`, `remove`) 및 `skip_mount` 동작을 존중한다.
- **첫 번째 시험 대상은** `/apex/com.android.conscrypt/cacerts/0f4ed297.0`이다.
- 기기에서 `/apex/com.android.conscrypt@<version>/cacerts`의 별도 경로로 접근한다면, 실제 조회 경로와 NoMount 동작을 확인한 뒤 **현재 활성화된 버전만** 별도 주입 대상으로 추가한다. 버전 이름을 하드코딩하거나 모든 이전 버전 디렉터리를 복제하지 않는다.
- UID 격리 옵션을 켠 경우 일부 앱에서는 주입된 인증서가 보이지 않을 수 있다.

### 5.4 로그 및 경로 청결

- 모든 디버그 로그는 `$MODDIR/logs/boot.log` 또는 `$MODDIR/boot.log`에 기록한다. 로그가 불필요하면 릴리스에서 비활성화할 수 있다.
- 절대 사용하지 않을 경로: `/data/local/tmp`, `/data/local/tmp/cert`, `/data/local/tmp/adguardcert.log`.
- `mktemp` 기본 경로, 임시 셸 리다이렉션, 설치 스크립트, 삭제 스크립트에서 해당 경로를 사용하지 않는지 검색한다.
- 기존 `/data/local/tmp` 파일은 **삭제하지 않는다**. 경로를 더 이상 변경하지 않는 것이 목표다.

## 6. 구현 단계

- [ ] **P0 — 환경 확인:** NoMount 초기화와 `nm version`, `metamount.sh` 단계 확인.
- [x] **P1 — 모듈 뼈대:** Bun + TypeScript로 설치 ZIP 생성. 부팅 스크립트 실행 권한 복구를 위한 `customize.sh` 포함.
- [x] **P2 — 단일 CA 검색:** 숫자 suffix 선택, 빈 파일 및 DER/PEM 외형 검사. 사용자 요청으로 OpenSSL 의존성과 X.509 검증을 제거하고 파일명 기반 식별의 한계를 문서화. 로컬 테스트 완료.
- [x] **P3 — 안전한 파일 생성:** 원자적 복사, 소유권·권한·실제 SELinux 레이블 적용, 실패 시 오래된 파일 제거. 파일 처리 로컬 테스트 완료, Android 메타데이터 처리는 모의 환경 검증.
- [ ] **P4 — NoMount 주입:** `apex/` 트리 자동 스캔 및 실제 VFS 규칙 확인.
- [ ] **P5 — 기능 검증:** AdGuard HTTPS 필터링, Chrome/Chromium, 사용자 CA를 기본적으로 신뢰하지 않는 테스트 앱 확인.
- [ ] **P6 — 갱신 및 복구:** 인증서 재발급·삭제·NoMount 비활성화·모듈 제거 시나리오 확인.

## 7. 테스트 계획 및 합격 기준

| 시험 | 확인 방법 | 합격 기준 |
|---|---|---|
| 기본 CA 검색 | `ls /data/misc/user/0/cacerts-added/0f4ed297.*` | Personal CA 후보 확인 |
| 파일 생성 | `ls -lZ /data/adb/modules/adguard-ca-nomount/apex/com.android.conscrypt/cacerts/` | `0f4ed297.0` 하나만 생성, 권한·레이블 적합 |
| 내용 일치 | 소스와 생성된 파일의 SHA-256 비교 | 동일 |
| VFS 규칙 | NoMount의 `nm rule list` | 목적지 CA 파일 규칙 존재 |
| Android 경로 | `ls -lZ /apex/com.android.conscrypt/cacerts/0f4ed297.0` 및 실제 접근 | 인증서 접근 가능 |
| 앱 신뢰 | AdGuard의 HTTPS 필터링 및 실제 요청 | 대상 앱에서 정상 동작 |
| Intermediate 유지 | 사용자 인증서 목록 확인 | Intermediate CA가 사용자 저장소에 유지 |
| tmp 경로 무사용 | 모듈 파일 정적 검색 및 설치 전후 비교 | `/data/local/tmp`에 새 변경 없음 |
| 불필요한 마운트 없음 | `/proc/*/mountinfo` 관련 엔트리 확인 | 모듈이 추가한 tmpfs/bind mount 없음 |
| 갱신 | AdGuard CA 재발급 후 재부팅 | 새 Personal CA가 반영 |
| CA 삭제·실패 | 사용자 CA 삭제/손상 후 재부팅 | 오래된 시스템 CA가 자동 재주입되지 않음 |
| 제거/롤백 | 모듈 비활성화·재부팅 | 주입 사라짐, 다른 시스템 CA 유지 |

`nm rule list`에 규칙이 나타나는 것과 Android/앱이 실제로 해당 인증서를 신뢰하는 것은 다른 검증 단계다. **마운트 흔적이 없다는 것만으로 보안 앱 탐지가 불가능해지는 것은 아니다.**

## 8. 위험 요소와 대응

| 위험 | 대응 |
|---|---|
| NoMount LKM 또는 메타모듈 미동작 | 주입 실패를 명확히 보고하고 정상 부팅을 유지 |
| APEX 별칭/버전 경로 차이 | 실제 활성 경로 확인 후 제한적인 추가 규칙 검토 |
| 파일은 보이지만 앱이 신뢰하지 않음 | Conscrypt 프로세스의 접근 경로·SELinux·UID 격리·인증서 체인 분리 점검 |
| `post-fs-data` 실행 순서 차이 | 표준 KernelSU와 late-load/APatch를 구분해서 검증 |
| AdGuard 인증서 재발급 | 매 부팅 사용자 저장소 재스캔 및 안전한 교체 |
| 인증서 식별 오인 | 해시 파일명 외에 X.509 식별 검증을 추가 |
| 부팅 불안정 | 모듈 단위 비활성화·복구 방법을 사전에 확보 |
| 다른 CA 모듈과 충돌 | 동일 파일에 대한 중복 주입 금지 |

## 9. 권장 릴리스 순서

**v0.1 — PoC**: 단일 CA 탐색·복사와 NoMount의 자동 파일 주입 확인. 수동 설치·재부팅 테스트.

**v0.2 — 안정화**: SELinux 및 APEX 버전별 경로 처리, 실패 처리, 인증서 갱신 시나리오.

**v1.0 — 최소 안정 버전**: 설치 ZIP, 검증 스크립트, 복구 안내, `/data/local/tmp` 접근 0회 검증.

## 10. 참고 자료

- [AdguardTeam/adguardcert — 기존 CA 선택 로직](https://github.com/AdguardTeam/adguardcert/blob/master/module/post-fs-data.sh)
- [AdGuard 공식 문서 — 루팅 기기의 시스템 CA 설치](https://kb.adguard.com/kb/adguard-for-android/solving-problems/https-certificate-for-rooted/)
- [NoMount — VFS 주입 구현](https://github.com/maxsteeel/nomount/blob/master/module/metamount.sh)
- [NoMount — 파일 경로 변환 규칙](https://github.com/maxsteeel/nomount/blob/master/module/rule-paths.sh)
- [KernelSU — 메타모듈 및 실행 순서](https://kernelsu.org/guide/metamodule.html)

---

**설계 결정:** 범용 CA 이동 기능을 구현하지 않는다. `adguardcert`의 **AdGuard Personal CA 탐색**만 차용하고, 시스템 저장소 주입은 **NoMount의 표준 모듈 스캔**에 위임한다. 이렇게 하면 코드 및 장기 유지보수 범위를 최소화하면서 `/data/local/tmp` 쓰기 문제와 추가 mount 생성 문제를 분리해 해결할 수 있다.
