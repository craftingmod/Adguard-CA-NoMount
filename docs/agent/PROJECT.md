# AdGuard CA for NoMount

Android 14+ 사용자 0의 AdGuard Personal CA 한 장을 NoMount에 전달하는 일반 KernelSU/APatch 모듈입니다. Intermediate CA와 사용자 인증서 저장소는 수정하지 않습니다.

## 설치 조건

- 메타모듈을 지원하는 KernelSU/APatch 및 활성화된 NoMount (`id=nomount`). `bin/nm version`이 성공해야 합니다.
- AdGuard에서 Personal CA와 Intermediate CA를 사용자 저장소에 먼저 설치합니다.
- adguardcert, MoveCertificate 등 같은 경로를 다루는 모듈을 비활성화합니다.
- OpenSSL이나 추가 인증서 파서는 필요하지 않습니다. AdGuard에서 직접 설치한 Personal CA인지 사용자 인증서 설정에서 확인합니다.
- 복구 모드 등에서 모듈을 비활성화할 수단을 준비합니다.

ZIP을 루트 관리자에서 설치하고 재부팅합니다. 설치 ZIP에는 인증서와 `apex/` 디렉터리가 없습니다. 루트 관리자가 ZIP을 풀 때 사용하는 자체 임시 경로는 이 모듈이 제어하지 않으므로 아래 경로 청결 검사에 포함해야 합니다.

## 동작과 제한

DER는 최상위 SEQUENCE의 길이와 실제 파일 크기가 일치하는지, PEM은 CERTIFICATE 시작·끝 표시와 Base64 문자로 된 본문이 한 묶음인지 확인합니다. PEM은 LF와 CRLF 모두 허용합니다. **외형 검사일 뿐 X.509 파싱이나 Base64 디코딩 검증은 아닙니다.** DER 내부 구조 손상이나 PEM 내부 데이터 오류는 발견하지 못할 수 있습니다.

`post-fs-data.sh`는 `/data/misc/user/0/cacerts-added/0f4ed297.<숫자>` 중 가장 큰 숫자 suffix를 선택합니다. 숫자는 갱신 시간을 보장하지 않습니다. 선택한 후보가 잘못되면 낮은 suffix로 되돌아가지 않습니다.

**인증서 식별은 파일명만 신뢰합니다.** Subject, subject hash 재계산, CA 여부, 서명, 유효기간은 검사하지 않습니다. 다른 인증서나 인증서가 아닌 데이터를 해당 파일명으로 넣어도 외형만 맞으면 복사됩니다. `47ec1af8.*`는 선택하지 않지만 Intermediate를 `0f4ed297.*`로 이름만 바꾸면 구별하지 못합니다. 사용자 저장소에 올바른 인증서를 설치할 권한과 관리 상태를 신뢰하는 방식이며 로그에도 이 제한을 남깁니다. SHA-256은 파일 비교용이지 신원 검증이 아닙니다.

모듈 내부에서 복사·외형 검사한 스냅샷에 root:root, 0644를 설정하고 실제 Conscrypt CA에서 읽은 SELinux 레이블을 적용한 뒤 원자적으로 교체합니다. SELinux가 활성화됐는데 레이블을 읽거나 적용할 수 없으면 실패합니다. 인증서 삭제·빈 파일·외형 검사 실패·NoMount 비활성화 등 실패 시 기존 목적지 인증서를 제거하고 부팅을 계속합니다. 모듈 스크립트가 아예 실행되지 않는 환경에서는 이 정리가 실행될 수 없습니다.

생성 파일은 모듈 내부의 `logs/boot.log`, 일시적인 `apex/com.android.conscrypt/cacerts/.cert.tmp`, 최종 `0f4ed297.0`뿐입니다. 로그는 매 부팅 덮어씁니다. `PREPARED`는 파일 준비 완료이며 주입이나 앱 신뢰 성공을 뜻하지 않습니다. 직접 마운트나 규칙 추가를 하지 않습니다.

Android 13 이하, 사용자 0 이외, 버전이 붙은 Conscrypt 별도 경로는 지원하지 않습니다. KernelSU late-load 및 APatch의 다른 실행 순서는 실기기 확인이 필요합니다. 실제 앱이 버전 경로만 조회하는 기기에서는 이 버전을 사용하지 마세요. UID 격리·SELinux·인증서 고정으로 일부 앱에서 동작하지 않을 수 있습니다.

## 재부팅 후 검증

v0.1.1은 KernelSU BusyBox의 `stat -c '%C'`가 레이블 대신 `C`를 출력하는 호환성 문제를 수정합니다. 레이블은 `ls -Zd` 출력의 유효한 SELinux 컨텍스트에서 읽고, 적용 후 같은 방식으로 재확인합니다. 이전 버전에서 `invalid context: C`가 발생했다면 새 ZIP으로 업데이트한 뒤 재부팅하세요.

다음 명령은 기기의 root shell에서 실행합니다. 호스트에서는 `bun run verify:device [serial]`로 읽기 검사 일부를 실행할 수 있습니다.

```sh
cat /data/adb/modules/adguard-ca-nomount/logs/boot.log
/data/adb/modules/nomount/bin/nm version
/data/adb/modules/nomount/bin/nm rule list
ls -lZ /data/adb/modules/adguard-ca-nomount/apex/com.android.conscrypt/cacerts/
ls -lZ /apex/com.android.conscrypt/cacerts/0f4ed297.0
sha256sum /data/misc/user/0/cacerts-added/0f4ed297.*
sha256sum /data/adb/modules/adguard-ca-nomount/apex/com.android.conscrypt/cacerts/0f4ed297.0
sha256sum /apex/com.android.conscrypt/cacerts/0f4ed297.0
ls -lZ /data/misc/user/0/cacerts-added/47ec1af8.*
```

1. Android 사용자 인증서 설정에서 해당 파일이 AdGuard Personal CA인지 확인합니다. 로그에서 선택한 소스·SHA-256·검증 제한 경고·`PREPARED`를 확인합니다. 목적지 디렉터리에는 최종 CA 한 장만 있어야 합니다. 소스, 모듈 복사본, Android 경로의 SHA-256이 같고 권한·레이블이 기존 CA와 맞아야 합니다.
2. `nm rule list`에서 Android 목적지와 모듈 내부 파일의 쌍을 확인합니다. NoMount 로그의 `Kernel API ready` → 이 모듈 준비 → NoMount `Injection Complete` 순서를 확인합니다. 순서가 다르면 지원 환경으로 판정하지 않습니다.
3. AdGuard HTTPS 필터링을 켜고 Chrome/Chromium 및 사용자 CA를 신뢰하지 않도록 설정된 테스트 앱에서 실제 HTTPS 요청을 실행합니다. 앱의 인증서 체인과 성공 여부를 기록합니다. root shell의 파일 접근과 앱 신뢰는 별도 검사입니다.
4. 설치 전후 및 부팅 전후의 `/data/local/tmp` 상태를 외부 관찰 도구로 비교합니다. 모듈은 그 경로에 접근하거나 기존 내용을 정리하지 않습니다. 결과는 루트 관리자·NoMount 자체의 접근과 구분합니다. `/proc/1/mountinfo`와 앱 프로세스의 mountinfo도 전후 비교하여 추가 tmpfs/bind mount가 없는지 확인합니다.
5. AdGuard CA 재발급 후 재부팅하여 SHA-256과 내용 일치가 바뀌는지 확인합니다. 후보 삭제·빈 파일·외형 손상·NoMount 비활성화 각각 재부팅 후 모듈 목적지 파일이 없어야 합니다. 외형을 유지한 내용 변조는 모듈이 거부하지 않는다는 점도 구분합니다. Intermediate는 사용자 저장소에 남아 있어야 합니다.

## 비활성화 및 복구

루트 관리자에서 모듈을 비활성화하거나 제거한 후 재부팅합니다. 부팅 문제가 있으면 복구 root shell에서 다음 파일을 생성하고 재부팅합니다.

```sh
touch /data/adb/modules/adguard-ca-nomount/disable
```

재부팅 후 해당 VFS 규칙과 Android 경로의 주입이 사라졌는지 확인합니다. 사용자 저장소나 다른 시스템 CA는 삭제하지 않습니다. 부팅 중 수동 재실행은 지원하지 않습니다. 기존 NoMount 규칙과 프로세스 캐시를 제거하려면 재부팅해야 합니다.
