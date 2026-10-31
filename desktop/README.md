# APDF Local 데스크톱 앱

Node.js, Python, Docker, 별도 브라우저 설치 없이 실행하는 PDF 편집·조합 앱입니다. 브라우저와 PDF 실행 엔진, 한글 글꼴이 앱 안에 들어 있습니다. **처음 실행할 때도 인터넷 연결이 필요하지 않습니다.** 서버 프로세스나 localhost 포트를 열지 않습니다.

## 실행

운영체제와 CPU에 맞는 배포 파일 하나를 받습니다. 실행 파일의 형식은 운영체제마다 다르지만 추가 개발 환경 설치는 공통으로 필요하지 않습니다.

| 운영체제 | 파일 | 실행 방법 |
| --- | --- | --- |
| Windows | `APDF-Local-<version>-win-<arch>.exe` | 포터블 EXE를 더블클릭합니다. 설치 프로그램이 아닙니다. |
| Windows | `APDF-Local-<version>-win-<arch>.zip` | 전체 압축을 풀고 폴더 안의 `APDF Local.exe`를 실행합니다. |
| macOS | `APDF-Local-<version>-mac-<arch>.dmg` / `.zip` | 앱을 Applications로 옮겨 실행합니다. |
| Linux | `APDF-Local-<version>-linux-<arch>.tar.gz` | 전체 압축을 풀고 `apdf-local` 실행 파일을 엽니다. 일반적인 그래픽 데스크톱 환경에서 사용합니다. |

`x64`는 Intel/AMD 64비트 PC, `arm64`는 Apple Silicon 및 ARM64 PC용입니다. ZIP/압축 배포판은 실행 파일 옆의 리소스 파일도 모두 함께 보관해야 합니다.

개인 인증서가 없는 현재 배포본은 Windows에서 디지털 서명되지 않았고, macOS는 임시 서명(ad-hoc)으로 빌드합니다. 운영체제의 앱 출처 확인이 표시될 수 있습니다. Developer ID/Authenticode 서명과 Apple 공증은 별도 자격 증명이 필요한 배포 단계입니다.

## 기능과 저장

- 기존 11개 편집 도구, 6종 도형, 투명도, 4종 자유 드로잉 펜과 한글 텍스트를 지원합니다.
- PDF는 앱 안의 작업 스레드에서 처리하며 업로드하지 않습니다. 앱의 네트워크 연결은 패키지 안의 리소스로 제한됩니다.
- Download PDF / Build PDF를 누르면 운영체제의 저장 창으로 저장합니다.
- 편집 중 닫기·새로고침·화면 이동 시 Stay / Leave 확인창이 표시됩니다. 편집 내용과 Undo는 메모리에 있으므로 종료 전에 다운로드해야 합니다.
- 조합용 원본은 앱의 IndexedDB에, 순서와 페이지 범위는 localStorage에 보관합니다. **Clear Sources**로 삭제할 수 있습니다. 브라우저 버전의 저장소와는 별개입니다.
- 데이터는 OS의 앱 데이터 폴더 아래 `APDF Local`에 보관됩니다. 포터블 EXE를 옮겨도 해당 PC의 사용자 데이터 폴더는 유지됩니다. 원본과 결과 PDF는 별도로 보관하세요.

## 개발 및 빌드

이 절의 Node.js 22.12+ 요구사항은 앱을 만드는 개발 PC에만 적용됩니다. 완성된 앱을 쓰는 PC에는 필요하지 않습니다.

```bash
npm ci
npm run desktop
```

```bash
npm run package:desktop        # 현재 OS, 현재 CPU
npm run package:desktop:win    # Windows x64 / arm64
npm run package:desktop:linux  # Linux x64 / arm64
npm run package:desktop:mac    # macOS x64 / arm64; Mac에서 실행
```

결과는 `desktop/releases`에 생성되며 런타임과 모든 PDF 의존성을 포함합니다. 개발 시 최초 빌드에는 의존성 다운로드를 위한 인터넷 연결이 필요합니다. macOS 앱의 DMG 생성과 서명은 Mac에서 수행해야 합니다. Linux에서 Windows를 교차 빌드할 때는 Wine 의존성을 피하려고 실행 파일의 리소스 편집을 생략하며, 포터블 실행기와 앱 창에는 APDF 아이콘이 적용됩니다. Windows 빌드에서는 실행 파일 리소스까지 적용합니다.

[Desktop apps 워크플로](../.github/workflows/desktop.yml)를 수동 실행하거나 `desktop-v*` 태그로 실행하면 Windows·macOS·Linux 러너에서 각각 x64/arm64 배포 파일을 생성합니다. 워크플로 파일만 추가했으며 원격 실행이나 게시를 자동으로 시작하지 않습니다.

## 검증

```bash
npm run test:desktop
npm run test:local
npm run build:desktop
APDF_TEST_PYTHON=python3 npm run test:desktop:browser
```

전체 기능 테스트의 PDF/이미지 샘플 생성에만 `app/requirements.txt`의 Python 라이브러리가 필요합니다. 제품의 실행·빌드에는 Python 설치가 필요하지 않습니다. Linux CI의 샌드박스 제한이 있는 테스트 호스트에서는 `APDF_TEST_NO_SANDBOX=1`로 자동 검증을 실행할 수 있습니다. 제품의 기본 설정은 renderer sandbox와 context isolation을 유지합니다.

패키징된 Linux 실행 파일을 직접 검사하려면 `APDF_DESKTOP_EXECUTABLE=/absolute/path/to/apdf-local`을 지정합니다. 테스트 프로필은 임시 폴더를 사용하며 실제 사용자의 PDF를 변경하지 않습니다. 개발자 전용 `APDF_DESKTOP_DATA_DIR` 환경 변수로 프로필 위치를 지정할 수도 있습니다.

브라우저 앱은 기존 `npm run local` 및 Docker/Python 명령으로 계속 실행할 수 있습니다. 웹 favicon과 Windows/macOS/Linux 앱 아이콘은 [공유 SVG 원본](../local-app/app-icon.svg)에서 `npm run icons`로 생성합니다.
