# Windows 데스크톱 배포

PowerShell에서 프로젝트 폴더로 이동한 뒤 아래 명령으로 빌드합니다.

```powershell
powershell -ExecutionPolicy Bypass -File .\desktop\build.ps1
```

완성 파일은 `dist\Hanex_CAPA_Desktop.exe`입니다. 이 파일 하나를 전달하면 Python을 별도로 설치하지 않아도 실행할 수 있습니다.

- 명령 프롬프트 없이 전용 창으로 실행됩니다.
- 내부 서버는 외부에 공개되지 않는 `127.0.0.1:5181`만 사용합니다.
- 앱 데이터는 `%LOCALAPPDATA%\HanexCapaDashboard`에 계속 저장됩니다.
- GAON 비밀번호는 저장하지 않아 앱을 다시 실행하면 재로그인이 필요합니다.
- 데스크톱 Outlook이 설치·로그인되어 있으면 메일을 보낼 수 있습니다.
- 브라우저 `localhost:5180` 데이터와 앱 데이터는 분리됩니다. 기존 도면·입력은 백업/불러오기로 옮길 수 있습니다.
