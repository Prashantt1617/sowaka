class AuthUser {
  const AuthUser({
    required this.id,
    required this.email,
    required this.name,
    required this.role,
    required this.company,
    this.profilePhotoUrl,
    this.location,
    this.state,
    this.designation,
    this.employmentType,
    this.department,
    this.teamDescription,
    this.managerName,
    this.joiningDate,
    this.birthday,
    this.recognition,
  });

  factory AuthUser.fromJson(Map<String, dynamic> json) {
    return AuthUser(
      id: json['id'] as String? ?? '',
      email: json['email'] as String? ?? '',
      name: json['name'] as String? ?? 'User',
      role: json['role'] as String? ?? 'employee',
      company: json['company'] as String? ?? 'Sowaka',
      profilePhotoUrl: _optionalString(json['profilePhotoUrl']),
      location: _optionalString(json['location']),
      state: _optionalString(json['state']),
      designation: _optionalString(json['designation']),
      employmentType: _optionalString(json['employmentType']),
      department: _optionalString(json['department']),
      teamDescription: _optionalString(json['teamDescription']),
      managerName: _optionalString(json['managerName']),
      joiningDate: _optionalString(json['joiningDate']),
      birthday: _optionalString(json['birthday']),
      recognition: json['recognition'] is Map<String, dynamic>
          ? UserRecognition.fromJson(
              json['recognition'] as Map<String, dynamic>,
            )
          : null,
    );
  }

  final String id;
  final String email;
  final String name;
  final String role;
  final String company;
  final String? profilePhotoUrl;
  final String? location;
  final String? state;
  final String? designation;
  final String? employmentType;
  final String? department;
  final String? teamDescription;
  final String? managerName;
  final String? joiningDate;
  final String? birthday;
  final UserRecognition? recognition;

  Map<String, dynamic> toJson() => {
    'id': id,
    'email': email,
    'name': name,
    'role': role,
    'company': company,
    'profilePhotoUrl': profilePhotoUrl,
    'location': location,
    'state': state,
    'designation': designation,
    'employmentType': employmentType,
    'department': department,
    'teamDescription': teamDescription,
    'managerName': managerName,
    'joiningDate': joiningDate,
    'birthday': birthday,
    'recognition': recognition?.toJson(),
  };

  AuthUser copyWith({String? profilePhotoUrl}) => AuthUser(
    id: id,
    email: email,
    name: name,
    role: role,
    company: company,
    profilePhotoUrl: profilePhotoUrl ?? this.profilePhotoUrl,
    location: location,
    state: state,
    designation: designation,
    employmentType: employmentType,
    department: department,
    teamDescription: teamDescription,
    managerName: managerName,
    joiningDate: joiningDate,
    birthday: birthday,
    recognition: recognition,
  );
}

class UserRecognition {
  const UserRecognition({required this.label, required this.period});

  factory UserRecognition.fromJson(Map<String, dynamic> json) {
    return UserRecognition(
      label: json['label'] as String? ?? '',
      period: json['period'] as String? ?? '',
    );
  }

  final String label;
  final String period;

  Map<String, dynamic> toJson() => {'label': label, 'period': period};
}

class AuthSession {
  const AuthSession({required this.token, required this.user});

  factory AuthSession.fromJson(Map<String, dynamic> json) {
    return AuthSession(
      token: json['token'] as String? ?? '',
      user: AuthUser.fromJson(json['user'] as Map<String, dynamic>? ?? {}),
    );
  }

  final String token;
  final AuthUser user;

  Map<String, dynamic> toJson() => {'token': token, 'user': user.toJson()};

  AuthSession copyWith({AuthUser? user}) =>
      AuthSession(token: token, user: user ?? this.user);
}

String? _optionalString(Object? value) {
  if (value is! String || value.trim().isEmpty) return null;
  return value;
}
