const { expect } = require('chai')
const UserHelper = require('./helpers/UserHelper')
const { db } = require('../../../app/src/infrastructure/mongodb')

describe('PasswordReset', function () {
  let email, response, user, userHelper, token, emailQuery
  beforeEach(async function () {
    userHelper = new UserHelper()
    email = userHelper.getDefaultEmail()
    emailQuery = `?email=${encodeURIComponent(email)}`
    userHelper = await UserHelper.createUser({ email })
    user = userHelper.user

    // generate the token
    await userHelper.getCsrfToken()
    response = await userHelper.request.post('/user/password/reset', {
      form: {
        email,
      },
    })

    token = (
      await db.tokens.findOne({
        'data.user_id': user._id.toString(),
      })
    ).token
  })
  describe('with a valid token', function () {
    describe('when logged in', function () {
      beforeEach(async function () {
        userHelper = await UserHelper.loginUser({
          email,
          password: userHelper.getDefaultPassword(),
        })
        response = await userHelper.request.get(
          `/user/password/set?passwordResetToken=${token}&email=${email}`,
          { simple: false }
        )
        expect(response.statusCode).to.equal(302)
        expect(response.headers.location).to.equal(
          `/user/password/set${emailQuery}`
        )
        // send reset request
        response = await userHelper.request.post('/user/password/set', {
          form: {
            passwordResetToken: token,
            password: 'a-password',
          },
        })
        userHelper = await UserHelper.getUser({ email })
        user = userHelper.user
      })
      it('update the password', async function () {
        expect(user.hashedPassword).to.exist
        expect(user.password).to.not.exist
      })
      it('log the change with initiatorId', async function () {
        const auditLog = userHelper.getAuditLogWithoutNoise()
        expect(auditLog).to.exist
        expect(auditLog[0]).to.exist
        expect(typeof auditLog[0].initiatorId).to.equal('object')
        expect(auditLog[0].initiatorId).to.deep.equal(user._id)
        expect(auditLog[0].operation).to.equal('reset-password')
        expect(auditLog[0].ipAddress).to.equal('127.0.0.1')
        expect(auditLog[0].timestamp).to.exist
      })
    })
    describe('when logged in as another user', function () {
      let otherUser, otherUserEmail
      beforeEach(async function () {
        otherUserEmail = userHelper.getDefaultEmail()
        userHelper = await UserHelper.createUser({ email: otherUserEmail })
        otherUser = userHelper.user
        userHelper = await UserHelper.loginUser({
          email: otherUserEmail,
          password: userHelper.getDefaultPassword(),
        })
        response = await userHelper.request.get(
          `/user/password/set?passwordResetToken=${token}&email=${email}`,
          { simple: false }
        )
        expect(response.statusCode).to.equal(302)
        expect(response.headers.location).to.equal(
          `/user/password/set${emailQuery}`
        )
        // send reset request
        response = await userHelper.request.post('/user/password/set', {
          form: {
            passwordResetToken: token,
            password: 'a-password',
          },
        })
        userHelper = await UserHelper.getUser({ email })
        user = userHelper.user
      })
      it('update the password', async function () {
        expect(user.hashedPassword).to.exist
        expect(user.password).to.not.exist
      })
      it('log the change with the logged in user as the initiatorId', async function () {
        const auditLog = userHelper.getAuditLogWithoutNoise()
        expect(auditLog).to.exist
        expect(auditLog[0]).to.exist
        expect(typeof auditLog[0].initiatorId).to.equal('object')
        expect(auditLog[0].initiatorId).to.deep.equal(otherUser._id)
        expect(auditLog[0].operation).to.equal('reset-password')
        expect(auditLog[0].ipAddress).to.equal('127.0.0.1')
        expect(auditLog[0].timestamp).to.exist
      })
    })
    describe('when not logged in', function () {
      beforeEach(async function () {
        response = await userHelper.request.get(
          `/user/password/set?passwordResetToken=${token}&email=${email}`,
          { simple: false }
        )
        expect(response.statusCode).to.equal(302)
        expect(response.headers.location).to.equal(
          `/user/password/set${emailQuery}`
        )
        // send reset request
        response = await userHelper.request.post('/user/password/set', {
          form: {
            passwordResetToken: token,
            password: 'a-password',
          },
        })
        userHelper = await UserHelper.getUser({ email })
        user = userHelper.user
      })
      it('updates the password', function () {
        expect(user.hashedPassword).to.exist
        expect(user.password).to.not.exist
      })
      it('log the change', async function () {
        const auditLog = userHelper.getAuditLogWithoutNoise()
        expect(auditLog).to.exist
        expect(auditLog[0]).to.exist
        expect(auditLog[0].initiatorId).to.equal(null)
        expect(auditLog[0].operation).to.equal('reset-password')
        expect(auditLog[0].ipAddress).to.equal('127.0.0.1')
        expect(auditLog[0].timestamp).to.exist
      })
    })
    describe('password checks', function () {
      beforeEach(async function () {
        response = await userHelper.request.get(
          `/user/password/set?passwordResetToken=${token}&email=${email}`,
          { simple: false }
        )
        expect(response.statusCode).to.equal(302)
        expect(response.headers.location).to.equal(
          `/user/password/set${emailQuery}`
        )
      })
      it('without a password should return 400 and not log the change', async function () {
        // send reset request
        response = await userHelper.request.post('/user/password/set', {
          form: {
            passwordResetToken: token,
          },
          simple: false,
        })
        expect(response.statusCode).to.equal(400)
        userHelper = await UserHelper.getUser({ email })

        const auditLog = userHelper.getAuditLogWithoutNoise()
        expect(auditLog).to.deep.equal([])
      })

      it('without a valid password should return 400 and not log the change', async function () {
        // send reset request
        response = await userHelper.request.post('/user/password/set', {
          form: {
            passwordResetToken: token,
            password: 'short',
          },
          simple: false,
        })
        expect(response.statusCode).to.equal(400)
        userHelper = await UserHelper.getUser({ email })

        const auditLog = userHelper.getAuditLogWithoutNoise()
        expect(auditLog).to.deep.equal([])
      })

      it('should flag email in password', async function () {
        const localPart = email.split('@').shift()
        // send bad password
        response = await userHelper.request.post('/user/password/set', {
          form: {
            passwordResetToken: token,
            password: localPart,
            email,
          },
          json: true,
          simple: false,
        })
        expect(response.statusCode).to.equal(400)
        expect(response.body).to.deep.equal({
          message: { text: 'password contains part of email address' },
        })
      })

      it('should be able to retry after providing an invalid password', async function () {
        // send bad password
        response = await userHelper.request.post('/user/password/set', {
          form: {
            passwordResetToken: token,
            password: 'short',
          },
          simple: false,
        })
        expect(response.statusCode).to.equal(400)

        // send good password
        response = await userHelper.request.post('/user/password/set', {
          form: {
            passwordResetToken: token,
            password: 'SomeThingVeryStrong!11',
          },
          simple: false,
        })
        expect(response.statusCode).to.equal(200)
        userHelper = await UserHelper.getUser({ email })

        const auditLog = userHelper.getAuditLogWithoutNoise()
        expect(auditLog.length).to.equal(1)
      })

      it('when the password is the same as current, should return 400 and log the change', async function () {
        // send reset request
        response = await userHelper.request.post('/user/password/set', {
          form: {
            passwordResetToken: token,
            password: userHelper.getDefaultPassword(),
          },
          simple: false,
        })
        expect(response.statusCode).to.equal(400)
        expect(JSON.parse(response.body).message.key).to.equal(
          'password-must-be-different'
        )
        userHelper = await UserHelper.getUser({ email })

        const auditLog = userHelper.getAuditLogWithoutNoise()
        expect(auditLog.length).to.equal(1)
      })
    })
  })

  describe('multiple attempts to set the password, reaching attempt limit', async function () {
    beforeEach(async function () {
      response = await userHelper.request.get(
        `/user/password/set?passwordResetToken=${token}&email=${email}`,
        { simple: false }
      )
      expect(response.statusCode).to.equal(302)
      expect(response.headers.location).to.equal(
        `/user/password/set${emailQuery}`
      )
    })

    it('should allow multiple attempts with same-password error, then deny further attempts', async function () {
      const sendSamePasswordRequest = async function () {
        return userHelper.request.post('/user/password/set', {
          form: {
            passwordResetToken: token,
            password: userHelper.getDefaultPassword(),
          },
          simple: false,
        })
      }
      // Three attempts at setting the password, all rejected for being the same as
      // the current password
      const response1 = await sendSamePasswordRequest()
      expect(response1.statusCode).to.equal(400)
      expect(JSON.parse(response1.body).message.key).to.equal(
        'password-must-be-different'
      )
      const response2 = await sendSamePasswordRequest()
      expect(response2.statusCode).to.equal(400)
      expect(JSON.parse(response2.body).message.key).to.equal(
        'password-must-be-different'
      )
      const response3 = await sendSamePasswordRequest()
      expect(response3.statusCode).to.equal(400)
      expect(JSON.parse(response3.body).message.key).to.equal(
        'password-must-be-different'
      )
      // Fourth attempt is rejected because the token has been used too many times
      const response4 = await sendSamePasswordRequest()
      expect(response4.statusCode).to.equal(404)
      expect(JSON.parse(response4.body).message.key).to.equal('token-expired')
    })

    it('should allow multiple attempts with same-password error, then set the password', async function () {
      const sendSamePasswordRequest = async function () {
        return userHelper.request.post('/user/password/set', {
          form: {
            passwordResetToken: token,
            password: userHelper.getDefaultPassword(),
          },
          simple: false,
        })
      }
      // Two attempts at setting the password, all rejected for being the same as
      // the current password
      const response1 = await sendSamePasswordRequest()
      expect(response1.statusCode).to.equal(400)
      expect(JSON.parse(response1.body).message.key).to.equal(
        'password-must-be-different'
      )
      const response2 = await sendSamePasswordRequest()
      expect(response2.statusCode).to.equal(400)
      expect(JSON.parse(response2.body).message.key).to.equal(
        'password-must-be-different'
      )
      // Third attempt is succeeds
      const response3 = await userHelper.request.post('/user/password/set', {
        form: {
          passwordResetToken: token,
          password: 'some-new-password',
        },
        simple: false,
      })
      expect(response3.statusCode).to.equal(200)
      // Check the user and audit log
      userHelper = await UserHelper.getUser({ email })
      user = userHelper.user
      expect(user.hashedPassword).to.exist
      expect(user.password).to.not.exist
      const auditLog = userHelper.getAuditLogWithoutNoise()
      expect(auditLog).to.exist
      expect(auditLog[0]).to.exist
      expect(auditLog[0].initiatorId).to.equal(null)
      expect(auditLog[0].operation).to.equal('reset-password')
      expect(auditLog[0].ipAddress).to.equal('127.0.0.1')
      expect(auditLog[0].timestamp).to.exist
    })
  })

  describe('without a valid token', function () {
    it('no token should redirect to page to re-request reset token', async function () {
      response = await userHelper.request.get(
        `/user/password/set?&email=${email}`,
        { simple: false }
      )
      expect(response.statusCode).to.equal(302)
      expect(response.headers.location).to.equal('/user/password/reset')
    })
    it('should show error for invalid tokens and return 404 if used', async function () {
      const invalidToken = 'not-real-token'
      response = await userHelper.request.get(
        `/user/password/set?&passwordResetToken=${invalidToken}&email=${email}`,
        { simple: false }
      )
      expect(response.statusCode).to.equal(302)
      expect(response.headers.location).to.equal(
        `/user/password/reset?error=token_expired`
      )
      // send reset request
      response = await userHelper.request.post('/user/password/set', {
        form: {
          passwordResetToken: invalidToken,
          password: 'a-password',
        },
        simple: false,
      })
      expect(response.statusCode).to.equal(404)
    })
  })
  describe('password reset', function () {
    it('should return 200 if email field is valid', async function () {
      response = await userHelper.request.post(`/user/password/reset`, {
        form: {
          email,
        },
      })
      expect(response.statusCode).to.equal(200)
    })

    it('should return 400 if email field is missing', async function () {
      response = await userHelper.request.post(`/user/password/reset`, {
        form: {
          mail: email,
        },
        simple: false,
      })
      expect(response.statusCode).to.equal(400)
    })
  })
  describe('password set', function () {
    it('should return 200 if password and passwordResetToken fields are valid', async function () {
      response = await userHelper.request.post(`/user/password/set`, {
        form: {
          password: 'new-password',
          passwordResetToken: token,
        },
      })
      expect(response.statusCode).to.equal(200)
    })

    it('should return 400 if password field is missing', async function () {
      response = await userHelper.request.post(`/user/password/set`, {
        form: {
          passwordResetToken: token,
        },
        simple: false,
      })
      expect(response.statusCode).to.equal(400)
    })

    it('should return 400 if passwordResetToken field is missing', async function () {
      response = await userHelper.request.post(`/user/password/set`, {
        form: {
          password: 'new-password',
        },
        simple: false,
      })
      expect(response.statusCode).to.equal(400)
    })
  })
})
